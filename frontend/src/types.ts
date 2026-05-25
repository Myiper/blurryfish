// ─── Response types matching the BlurryFish FastAPI backend ─────────────────

export interface StepBase {
  step: string;
  stepIndex: number;
  subStep: string;
  label: string;
  description: string;
  job_id: string;
}

export interface SingleImageStep extends StepBase {
  image: string; // base64 PNG
  download_url: string;
}

export interface ClaheResult extends SingleImageStep {
  step: 'clahe';
}

export interface ColorCorrectionResult extends SingleImageStep {
  step: 'color_correction';
}

export interface UnetDenoisingResult extends SingleImageStep {
  step: 'unet_denoising';
  modelAvailable: boolean;
}

export interface BoundingBox {
  xyxy: [number, number, number, number];
  confidence: number;
  class_id?: number;
  label?: string;
}

export interface DetectionResult extends SingleImageStep {
  step: 'detection';
  fishCount: number;
  boxes: BoundingBox[];
}

export interface UpscalingResult extends StepBase {
  step: 'upscaling';
  method: 'realesrgan' | 'lanczos';
  fishCount: number;
  crops: string[];      // base64 array
  upscaled: string[];   // base64 array
  crop_urls: string[];
  upscaled_urls: string[];
}

// SSE-specific sub-types emitted during /process
export interface CropsEvent extends StepBase {
  step: 'crops';
  images: string[];
  download_urls: string[];
}

export interface UpscaledEvent extends StepBase {
  step: 'upscaled';
  method: 'realesrgan' | 'lanczos';
  images: string[];
  download_urls: string[];
}

export interface FinalEvent extends SingleImageStep {
  step: 'final';
  fishCount: number;
  upscaledCount: number;
}

export type SSEEvent =
  | ClaheResult
  | ColorCorrectionResult
  | UnetDenoisingResult
  | DetectionResult
  | CropsEvent
  | UpscaledEvent
  | FinalEvent;

// ─── App-level state types ───────────────────────────────────────────────────

export type StepId =
  | 'clahe'
  | 'color_correction'
  | 'unet_denoising'
  | 'detection'
  | 'upscaling';

export interface StepInfo {
  id: StepId;
  stepIndex: number;
  subStep: string;
  label: string;
  description: string;
  endpoint: string;
  input: string;
  output: string;
}

export interface StepState {
  status: 'idle' | 'loading' | 'success' | 'error';
  result?: SSEEvent | UpscalingResult;
  error?: string;
}

export interface HealthStatus {
  status: string;
  models: {
    unet: boolean;
    yolo: boolean;
    esrgan: boolean;
  };
  storage: string;
}
