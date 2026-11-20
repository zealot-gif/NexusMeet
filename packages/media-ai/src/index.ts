import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';

export interface MediaAIOptions {
  enableBackgroundBlur: boolean;
  blurRadius: number;
  enableNoiseSuppression: boolean;
}

export class EdgeMediaProcessor {
  private segmenter: ImageSegmenter | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videoElement: HTMLVideoElement;
  private animationFrameId: number | null = null;
  private options: MediaAIOptions = {
    enableBackgroundBlur: false,
    blurRadius: 12,
    enableNoiseSuppression: true,
  };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
  }

  async initVisionModel(): Promise<void> {
    if (this.segmenter) return;
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    this.segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
    });
  }

  public updateOptions(newOptions: Partial<MediaAIOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  async processVideoTrack(rawTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
    await this.initVisionModel();
    const settings = rawTrack.getSettings();
    this.canvas.width = settings.width || 1280;
    this.canvas.height = settings.height || 720;

    this.videoElement.srcObject = new MediaStream([rawTrack]);
    await this.videoElement.play();

    const renderLoop = () => {
      if (this.videoElement.readyState >= 2) {
        const { width, height } = this.canvas;
        if (!this.options.enableBackgroundBlur || !this.segmenter) {
          this.ctx.filter = 'none';
          this.ctx.drawImage(this.videoElement, 0, 0, width, height);
        } else {
          this.ctx.save();
          this.ctx.filter = `blur(${this.options.blurRadius}px)`;
          this.ctx.drawImage(this.videoElement, 0, 0, width, height);
          this.ctx.restore();

          const result = this.segmenter.segmentForVideo(this.videoElement, performance.now());
          if (result.categoryMask) {
            this.applyForegroundMask(result.categoryMask);
            result.categoryMask.close();
          }
        }
      }
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return this.canvas.captureStream(30).getVideoTracks()[0];
  }

  private applyForegroundMask(mask: any): void {
    const { width, height } = this.canvas;
    const maskData = mask.getAsUint8Array();
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(this.videoElement, 0, 0, width, height);

    const imgData = tempCtx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    for (let i = 0; i < maskData.length; i++) {
      if (maskData[i] !== 0) {
        pixels[i * 4 + 3] = 0;
      }
    }
    tempCtx.putImageData(imgData, 0, 0);
    this.ctx.drawImage(tempCanvas, 0, 0);
  }

  async processAudioTrack(rawTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
    const audioCtx = new AudioContext({ sampleRate: 48000 });
    const source = audioCtx.createMediaStreamSource(new MediaStream([rawTrack]));

    const highPassFilter = audioCtx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 100;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.ratio.value = 4;

    const destination = audioCtx.createMediaStreamDestination();
    source.connect(highPassFilter);
    highPassFilter.connect(compressor);
    compressor.connect(destination);

    return destination.stream.getAudioTracks()[0];
  }

  public destroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.segmenter?.close();
  }
}
