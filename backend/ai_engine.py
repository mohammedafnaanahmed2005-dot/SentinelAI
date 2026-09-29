import os
import cv2
import numpy as np
import base64
import io
from PIL import Image
from typing import Dict, Any, List, Optional

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
YUNET_MODEL_PATH = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
SFACE_MODEL_PATH = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

# OpenCV official SFace decision threshold (FR_COSINE). Cosine similarity above
# this value means "same identity". compute_similarity() calibrates this exact
# point to 0.55 which matches the updated default policy face_threshold and
# gives better webcam-to-webcam matching accuracy.
SFACE_COSINE_THRESHOLD = 0.363
CALIBRATED_SIM_AT_THRESHOLD = 0.55


class AIEngine:
    """
    Face detection / recognition engine.

    Primary pipeline (robust on live webcam streams):
      * Detection  : OpenCV YuNet (ONNX) -> bbox + 5 facial landmarks
      * Recognition: OpenCV SFace (ONNX) -> 128-d aligned face descriptor

    Falls back to Haar cascades if the ONNX models are unavailable so the
    server still boots on a minimal install.
    """

    EMBEDDING_DIM = 128

    def __init__(self):
        # --- YuNet face detector (primary) ---
        self.yunet: Optional[cv2.FaceDetectorYN] = None
        if os.path.exists(YUNET_MODEL_PATH) and hasattr(cv2, "FaceDetectorYN"):
            try:
                self.yunet = cv2.FaceDetectorYN.create(
                    YUNET_MODEL_PATH, "",
                    (320, 320),       # initial input size, resized per frame
                    0.5,              # score threshold (lowered for backlit/low-light faces)
                    0.3,              # NMS threshold
                    5000              # top-k candidates
                )
            except cv2.error:
                self.yunet = None

        # --- SFace recognizer (primary) ---
        self.recognizer: Optional[cv2.FaceRecognizerSF] = None
        if os.path.exists(SFACE_MODEL_PATH) and hasattr(cv2, "FaceRecognizerSF"):
            try:
                self.recognizer = cv2.FaceRecognizerSF.create(SFACE_MODEL_PATH, "")
            except cv2.error:
                self.recognizer = None

        # --- Haar cascades (fallback only, cv2 < 5.0) ---
        # CascadeClassifier was removed in OpenCV 5. Guard so the server
        # still boots on OpenCV 5+ where YuNet/SFace are always available.
        self.face_cascade = None
        self.eye_cascade  = None
        if hasattr(cv2, "CascadeClassifier") and hasattr(cv2, "data"):
            try:
                self.face_cascade = cv2.CascadeClassifier(
                    cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
                )
                self.eye_cascade = cv2.CascadeClassifier(
                    cv2.data.haarcascades + 'haarcascade_eye.xml'
                )
            except Exception:
                self.face_cascade = None
                self.eye_cascade  = None

    # ------------------------------------------------------------------ #
    #  Utilities
    # ------------------------------------------------------------------ #
    def decode_base64_image(self, base64_str: str) -> np.ndarray:
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
        img_bytes = base64.b64decode(base64_str)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

    def enhance_image(self, image_bgr: np.ndarray) -> np.ndarray:
        """CLAHE contrast normalisation (L channel only).

        Low webcam lighting depresses SFace cosine similarity even for the
        genuine owner; re-running detection on an enhanced frame recovers a
        large part of that loss without altering colours.
        """
        lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
        l_ch, a_ch, b_ch = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        l_ch = clahe.apply(l_ch)
        return cv2.cvtColor(cv2.merge((l_ch, a_ch, b_ch)), cv2.COLOR_LAB2BGR)

    def _extract_embedding(self, image_bgr: np.ndarray,
                           face_row: Optional[np.ndarray],
                           face_crop_bgr: np.ndarray) -> Optional[List[float]]:
        """128-d SFace descriptor. Uses landmark alignment when available."""
        if self.recognizer is None:
            return None
        try:
            if face_row is not None:
                aligned = self.recognizer.alignCrop(image_bgr, face_row)
            else:
                # Haar fallback has no landmarks: approximate with a plain
                # 112x112 resize (SFace's native input size).
                aligned = cv2.resize(face_crop_bgr, (112, 112))
            feat = self.recognizer.feature(aligned)
            return np.ndarray.flatten(feat).tolist()
        except cv2.error:
            return None

    def _liveness_from_crop(self, face_roi_gray: np.ndarray) -> float:
        """Texture-sharpness liveness proxy (blurry/print attacks score low)."""
        if face_roi_gray.size == 0:
            return 0.2
        laplacian_var = cv2.Laplacian(face_roi_gray, cv2.CV_64F).var()
        # Normal webcams land between 50 and 800 (low = blurred / print attack)
        return round(float(min(1.0, max(0.2, laplacian_var / 250.0))), 3)

    @staticmethod
    def _no_face(message: str) -> Dict[str, Any]:
        return {
            "face_detected": False,
            "face_bbox": None,
            "iris_detected": False,
            "iris_points": [],
            "liveness_score": 0.0,
            "embedding": None,
            "message": message
        }

    # ------------------------------------------------------------------ #
    #  Detection
    # ------------------------------------------------------------------ #
    def detect_face_and_iris(self, image_bgr: np.ndarray, fast_mode: bool = False) -> Dict[str, Any]:
        """
        Detects the primary face, derives iris/eye anchor points, computes a
        liveness score and extracts the 128-d SFace embedding.

        Robust cascade: YuNet on the raw frame -> YuNet on a CLAHE-enhanced
        frame (recovers backlit / low-light faces) -> Haar cascade fallback.
        Each stage only short-circuits when a face is actually found.

        fast_mode=True skips the CLAHE enhancement pass and the Haar fallback.
        Use this for lightweight HUD polling where speed matters more than
        recovery accuracy. The full multi-pass path is always used at login.
        """
        if image_bgr is None or image_bgr.size == 0:
            return self._no_face("Empty frame received from webcam stream.")

        # All-black frame => the sensor is not delivering real data (privacy
        # shutter / lens cover closed, another app holding the device, or no
        # light at all). Report it explicitly as frame_black so the UI can tell
        # the user what to fix instead of silently "not detecting" a face.
        if float(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).mean()) < 5.0:
            result = self._no_face(
                "Camera feed is BLACK - open the webcam privacy shutter / remove "
                "the lens cover / ensure the camera is not held by another app."
            )
            result["frame_black"] = True
            return result

        # 1) YuNet on the raw frame (primary detector)
        if self.yunet is not None:
            result = self._detect_with_yunet(image_bgr)
            if result is not None:
                return result

            # 2) YuNet on a contrast-enhanced frame. Strong backlight (e.g. a
            # bright window behind the subject) or dim rooms sink raw YuNet
            # scores below threshold; CLAHE restores enough contrast to detect.
            # Skipped in fast_mode (HUD polling) to keep latency low.
            if not fast_mode:
                try:
                    result = self._detect_with_yunet(self.enhance_image(image_bgr))
                    if result is not None:
                        return result
                except cv2.error:
                    pass

        # 3) Haar cascade fallback (only when YuNet found nothing AND cascades
        # are available — CascadeClassifier was removed in OpenCV 5).
        # Skipped in fast_mode to keep polling fast.
        if not fast_mode and self.face_cascade is not None:
            return self._detect_with_haar(image_bgr)

        return self._no_face("No face detected in webcam stream.")

    def _detect_with_yunet(self, image_bgr: np.ndarray) -> Optional[Dict[str, Any]]:
        h, w = image_bgr.shape[:2]
        try:
            self.yunet.setInputSize((w, h))
            _, faces = self.yunet.detect(image_bgr)
        except cv2.error:
            return None

        # No face on this pass -> return None so the caller can try the next
        # stage (enhanced YuNet, then Haar) instead of stopping here.
        if faces is None or len(faces) == 0:
            return None

        # Reject spurious micro-detections. Lowered score thresholds can latch
        # onto background texture (a 20-30px patch) that is not a face; a real
        # subject at webcam distance always spans far more pixels.
        min_side = max(40, int(min(w, h) * 0.10))
        faces = [f for f in faces if f[2] >= min_side and f[3] >= min_side]
        if not faces:
            return None

        # Pick the largest face (primary subject closest to the camera)
        face_row = max(faces, key=lambda f: f[2] * f[3])
        fx, fy, fw, fh = (int(round(v)) for v in face_row[:4])
        fx, fy = max(0, fx), max(0, fy)
        fw, fh = max(1, min(fw, w - fx)), max(1, min(fh, h - fy))

        face_crop_bgr = image_bgr[fy:fy + fh, fx:fx + fw]
        face_crop_gray = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2GRAY)

        # YuNet landmark layout: [x,y,w,h, re_x,re_y, le_x,le_y, nose_x,nose_y,
        #                         mouth_r_x,mouth_r_y, mouth_l_x,mouth_l_y, score]
        iris_points = []
        eye_radius = max(3, int(fw * 0.09))
        for idx, tag in ((4, "right"), (6, "left")):
            ex, ey = float(face_row[idx]), float(face_row[idx + 1])
            if ex <= 0 or ey <= 0:
                continue
            half = max(eye_radius, int(fw * 0.14))
            iris_points.append({
                "x": int(round(ex)),
                "y": int(round(ey)),
                "radius": eye_radius,
                "eye_box": [int(round(ex)) - half, int(round(ey)) - half, half * 2, half * 2]
            })

        confidence = float(face_row[14]) if len(face_row) > 14 else 1.0
        embedding = self._extract_embedding(image_bgr, face_row, face_crop_bgr)

        return {
            "face_detected": True,
            "face_bbox": [fx, fy, fw, fh],
            "face_confidence": round(confidence, 3),
            "iris_detected": len(iris_points) > 0,
            "iris_points": iris_points,
            "liveness_score": self._liveness_from_crop(face_crop_gray),
            "embedding": embedding,
            "message": "Face and Iris successfully acquired (YuNet + SFace)."
        }

    def _detect_with_haar(self, image_bgr: np.ndarray) -> Dict[str, Any]:
        if self.face_cascade is None:
            return self._no_face("No face detected (Haar cascades unavailable on this OpenCV build).")
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        # Contrast normalisation greatly improves Haar recall under uneven /
        # low webcam lighting. CLAHE first, then a slightly finer second pass.
        # minNeighbors is kept >=4 on purpose: looser values (2-3) produce
        # false positives on empty rooms / textured backgrounds.
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_clahe = clahe.apply(gray)

        faces = self.face_cascade.detectMultiScale(
            gray_clahe, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
        )
        detect_gray = gray_clahe
        if len(faces) == 0:
            faces = self.face_cascade.detectMultiScale(
                gray_clahe, scaleFactor=1.05, minNeighbors=4, minSize=(48, 48)
            )

        if len(faces) == 0:
            return self._no_face("No face detected in webcam stream.")

        faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
        (x, y, w, h) = faces[0]
        face_roi_gray = detect_gray[y:y + h, x:x + w]
        face_roi_bgr = image_bgr[y:y + h, x:x + w]

        # Detect eyes within the upper 65% of the face
        upper_face_gray = face_roi_gray[0:int(h * 0.65), :]
        eyes = self.eye_cascade.detectMultiScale(
            upper_face_gray, scaleFactor=1.1, minNeighbors=3, minSize=(20, 20)
        )

        iris_points = []
        for (ex, ey, ew, eh) in eyes[:2]:
            eye_roi = upper_face_gray[ey:ey + eh, ex:ex + ew]
            if eye_roi.size == 0:
                continue
            blurred = cv2.GaussianBlur(eye_roi, (7, 7), 0)
            _, _, min_loc, _ = cv2.minMaxLoc(blurred)
            iris_points.append({
                "x": int(x + ex + min_loc[0]),
                "y": int(y + ey + min_loc[1]),
                "radius": max(3, int(ew * 0.18)),
                "eye_box": [int(x + ex), int(y + ey), int(ew), int(eh)]
            })

        embedding = self._extract_embedding(image_bgr, None, face_roi_bgr)

        return {
            "face_detected": True,
            "face_bbox": [int(x), int(y), int(w), int(h)],
            "face_confidence": 0.5,
            "iris_detected": len(iris_points) > 0,
            "iris_points": iris_points,
            "liveness_score": self._liveness_from_crop(face_roi_gray),
            "embedding": embedding,
            "message": "Face acquired (Haar fallback - ONNX models unavailable)."
        }

    # ------------------------------------------------------------------ #
    #  Matching
    # ------------------------------------------------------------------ #
    def compute_similarity(self, emb1: List[float], emb2: List[float]) -> float:
        """
        Calibrated similarity between two SFace descriptors, scaled to [0, 1].

        Raw cosine similarity is mapped piecewise-linearly so that the official
        SFace decision threshold (cos = 0.363) lands exactly on 0.55 — the
        default `face_threshold` security policy value. Below the threshold the
        score decays towards 0; above it, it climbs towards 1.
        """
        if not emb1 or not emb2 or len(emb1) != len(emb2):
            return 0.0
        v1 = np.array(emb1, dtype=np.float32)
        v2 = np.array(emb2, dtype=np.float32)

        norm1 = np.linalg.norm(v1)
        norm2 = np.linalg.norm(v2)
        if norm1 == 0 or norm2 == 0:
            return 0.0

        cos = float(np.dot(v1, v2) / (norm1 * norm2))
        cos = max(-1.0, min(1.0, cos))

        t = SFACE_COSINE_THRESHOLD
        target = CALIBRATED_SIM_AT_THRESHOLD
        if cos >= t:
            similarity = target + (cos - t) * ((1.0 - target) / (1.0 - t))
        else:
            similarity = (cos + 1.0) * (target / (1.0 + t))

        return round(float(np.clip(similarity, 0.0, 1.0)), 4)


ai_engine = AIEngine()
