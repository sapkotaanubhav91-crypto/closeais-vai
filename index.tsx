/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @google/genai-api: Fix: Refactored to use Session Promise to prevent race conditions.
import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData, blobToBase64} from './utils.js';
import './visual-3d.js';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = 'Tap the mic to talk';
  @state() error = '';
  // @google/genai-api: Fix: Update default voice and remove invalid voice option.
  @state() selectedVoice = 'Zephyr';
  @state() isSettingsOpen = false;
  @state() profilePhotoUri: string | null = null;
  @state() isCameraOpen = false;
  @state() isSharingScreen = false;
  @state() isScreenSharePaused = false;
  @state() isScreenShareSupported = true;

  private readonly voices = [
    'Zephyr',
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
  ];

  private client: GoogleGenAI;
  // @google/genai-api: Fix: Use a promise for the session to avoid race conditions.
  private sessionPromise: Promise<Session>;
  // @google/genai-api: Fix: Cast window to any to resolve TypeScript error for webkitAudioContext.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  // @google/genai-api: Fix: Cast window to any to resolve TypeScript error for webkitAudioContext.
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private screenStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private screenFrameInterval: number | null = null;


  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: #333;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;

      button {
        outline: none;
        border: 1px solid #e0e0e0;
        color: #333;
        border-radius: 50%;
        background: #f0f0f0;
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;

        &:hover {
          background: #e0e0e0;
        }
      }

      button[disabled] {
        display: none;
      }
    }

    .profile-button {
      position: absolute;
      top: 20px;
      right: 20px;
      z-index: 20;
      outline: none;
      border: 1px solid #e0e0e0;
      color: #333;
      border-radius: 50%;
      background: #f0f0f0;
      width: 48px;
      height: 48px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 0.2s, transform 0.2s;
      padding: 0;
      overflow: hidden;

      &:hover {
        background: #e0e0e0;
        transform: rotate(15deg);
      }
    }

    .profile-avatar {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .settings-panel {
      position: absolute;
      top: 80px;
      right: 20px;
      z-index: 19;
      background: #ffffff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      transform: translateY(-20px);
      opacity: 0;
      visibility: hidden;
      transition: transform 0.3s ease, opacity 0.3s ease, visibility 0.3s;
    }

    .settings-panel.open {
      transform: translateY(0);
      opacity: 1;
      visibility: visible;
    }

    .settings-panel label {
      color: #333;
      font-size: 14px;
    }

    .settings-panel select {
      outline: none;
      border: 1px solid #ccc;
      color: #333;
      border-radius: 8px;
      background: #f9f9f9;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 16px;
      -webkit-appearance: none;
      appearance: none;
      background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23333' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 0.7rem center;
      background-size: 1em;
      padding-right: 2.5rem;
      transition: background-color 0.2s;

      &:hover {
        background-color: #f0f0f0;
      }
    }

    .settings-panel .voice-selector {
      display: flex;
      flex-direction: column;
      gap: 5px;
      align-items: flex-start;
    }

    .settings-panel button {
      outline: none;
      border: 1px solid #e0e0e0;
      color: #333;
      border-radius: 8px;
      background: #f9f9f9;
      padding: 10px;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background-color 0.2s;

      &:hover {
        background-color: #f0f0f0;
      }
    }
    
    .settings-panel button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .camera-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.5);
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .camera-modal-content {
        background: white;
        padding: 20px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 15px;
    }

    #camera-video {
        border-radius: 8px;
        max-width: 80vw;
        max-height: 60vh;
    }

    .modal-buttons {
        display: flex;
        gap: 10px;
    }

    .modal-buttons button {
        padding: 10px 20px;
        font-size: 16px;
        cursor: pointer;
        border-radius: 8px;
        border: 1px solid #ccc;
    }
  `;

  constructor() {
    super();
    this.isScreenShareSupported = !!(
      navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia
    );
    this.initClient();
    this.loadProfilePhoto();
  }

  private loadProfilePhoto() {
    const photo = localStorage.getItem('profilePhoto');
    if (photo) {
      this.profilePhotoUri = photo;
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    this.sessionPromise = this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          console.log('Session opened');
        },
        onmessage: async (message: LiveServerMessage) => {
          const audio =
            message.serverContent?.modelTurn?.parts[0]?.inlineData;

          if (audio) {
            this.nextStartTime = Math.max(
              this.nextStartTime,
              this.outputAudioContext.currentTime,
            );

            const audioBuffer = await decodeAudioData(
              decode(audio.data),
              this.outputAudioContext,
              24000,
              1,
            );
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputNode);
            source.addEventListener('ended', () => {
              this.sources.delete(source);
            });

            source.start(this.nextStartTime);
            this.nextStartTime = this.nextStartTime + audioBuffer.duration;
            this.sources.add(source);
          }

          const interrupted = message.serverContent?.interrupted;
          if (interrupted) {
            for (const source of this.sources.values()) {
              source.stop();
              this.sources.delete(source);
            }
            this.nextStartTime = 0;
          }
        },
        onerror: (e: ErrorEvent) => {
          this.updateError('An error occurred. Please refresh and try again.');
        },
        onclose: (e: CloseEvent) => {
          console.log('Session closed:', e.reason);
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {voiceName: this.selectedVoice},
          },
        },
        systemInstruction: `When asked who created you or who trained you, respond with: 'I was trained by CloseAI's, an AI company designed to help people with tasks. The founder of CloseAI's is Anubhav Sapkota. He is 12 years old, and he is the world's youngest entrepreneur of AI.' Only if you are asked who Anubhav's friend is, then you should respond with: 'One of his best friends is Ahmed Qamar. Ahmed is a good and real friend of Daksh. Daksh is good, but he is a little greedy and wants Anubhav not to be friends with Ahmed.' If the user shares their screen, you can see it. Be helpful and provide assistance based on the content of the screen.

In addition to that, you have extreme reasoning capabilities. Always follow these rules:
1. Think through the problem step-by-step before answering. Think out loud as you reason, like you're walking someone through your thoughts.
2. Explain your reasoning clearly and logically. Don't rush to the answer; make it feel like a discovery.
3. If facts are uncertain or data is missing, admit it, state your confidence level, explain your assumptions, and say how you'd verify it.
4. Use simple, concrete examples when possible.
5. Avoid overgeneralizations and back every claim with reasoning or evidence.
6. Always end with a short summary of your conclusion and why it makes sense.
7. Explain as if teaching a sharp beginner: full clarity, zero fluff.
8. Keep the tone confident but grounded.`,
      },
    });

    this.sessionPromise.catch((e) => {
      console.error(e);
      this.updateError(e.message);
    });
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
    this.status = '';
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Listening...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateError(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Tap the mic to talk');
  }

  private reset() {
    this.sessionPromise?.then((session) => session.close());
    this.initSession();
    this.updateStatus('Ready for a new conversation.');
  }

  private handleVoiceChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    this.selectedVoice = target.value;
    this.reset();
  }

  private toggleSettings() {
    this.isSettingsOpen = !this.isSettingsOpen;
  }

  private async openCamera() {
    try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
        this.isCameraOpen = true;
        await this.updateComplete; 
        const videoEl = this.shadowRoot?.querySelector('#camera-video') as HTMLVideoElement;
        if (videoEl) {
            videoEl.srcObject = this.cameraStream;
        }
    } catch (err) {
        this.updateError('Could not access camera. Please check permissions.');
        console.error('Camera access error:', err);
    }
  }

  private closeCamera() {
      if (this.cameraStream) {
          this.cameraStream.getTracks().forEach(track => track.stop());
      }
      this.isCameraOpen = false;
      this.cameraStream = null;
  }

  private takePhoto() {
      const videoEl = this.shadowRoot?.querySelector('#camera-video') as HTMLVideoElement;
      if (!videoEl) return;

      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL('image/jpeg');
      
      localStorage.setItem('profilePhoto', dataUri);
      this.profilePhotoUri = dataUri;

      this.closeCamera();
  }

  private toggleScreenShare() {
      if (this.isSharingScreen) {
          this.stopScreenShare();
      } else {
          this.startScreenShare();
      }
  }

  private togglePauseResumeScreenShare() {
    if (this.isScreenSharePaused) {
      this.resumeScreenShare();
    } else {
      this.pauseScreenShare();
    }
  }

  private startFrameInterval() {
    this.stopFrameInterval(); // Ensure no multiple intervals are running

    const sendFrame = async () => {
        if (!this.isSharingScreen) return; // Stop if sharing has been terminated
        const videoEl = this.shadowRoot?.querySelector('#screenShareVideo') as HTMLVideoElement;
        if (!videoEl || videoEl.paused || videoEl.ended || videoEl.videoWidth === 0) return;

        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
            if (blob) {
                const base64Data = await blobToBase64(blob);
                this.sessionPromise.then((session) => {
                    session.sendRealtimeInput({
                        media: { data: base64Data, mimeType: 'image/jpeg' },
                    });
                });
            }
        }, 'image/jpeg', 0.7);
    };
    
    this.screenFrameInterval = window.setInterval(sendFrame, 1000);
  }

  private stopFrameInterval() {
    if (this.screenFrameInterval) {
        clearInterval(this.screenFrameInterval);
        this.screenFrameInterval = null;
    }
  }

  private async startScreenShare() {
    if (!this.isScreenShareSupported) {
      this.updateError('Screen sharing is not supported by your browser.');
      return;
    }
    try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        this.isSharingScreen = true;
        this.isScreenSharePaused = false;

        await this.updateComplete;
        const videoEl = this.shadowRoot?.querySelector('#screenShareVideo') as HTMLVideoElement;
        if (videoEl) {
            videoEl.srcObject = this.screenStream;
            videoEl.play();
        }

        this.screenStream.getVideoTracks()[0].onended = () => {
            this.stopScreenShare();
        };
        
        this.startFrameInterval();
        this.updateStatus('Screen sharing started.');

    } catch (err) {
        this.updateError('Could not start screen sharing.');
        console.error('Screen share error:', err);
    }
  }

  private stopScreenShare() {
      this.stopFrameInterval();
      if (this.screenStream) {
          this.screenStream.getTracks().forEach(track => track.stop());
          this.screenStream = null;
      }
      this.isSharingScreen = false;
      this.isScreenSharePaused = false;
      this.updateStatus('Screen sharing stopped.');
  }

  private pauseScreenShare() {
    this.stopFrameInterval();
    const videoEl = this.shadowRoot?.querySelector('#screenShareVideo') as HTMLVideoElement;
    if (videoEl) videoEl.pause();
    this.isScreenSharePaused = true;
    this.updateStatus('Screen sharing paused.');
  }

  private resumeScreenShare() {
    const videoEl = this.shadowRoot?.querySelector('#screenShareVideo') as HTMLVideoElement;
    if (videoEl) videoEl.play();
    this.isScreenSharePaused = false;
    this.startFrameInterval();
    this.updateStatus('Screen sharing resumed.');
  }

  render() {
    return html`
      <div>
        ${this.isCameraOpen ? html`
            <div class="camera-modal">
                <div class="camera-modal-content">
                    <video id="camera-video" autoplay playsinline></video>
                    <div class="modal-buttons">
                        <button @click=${this.takePhoto}>Snap</button>
                        <button @click=${this.closeCamera}>Cancel</button>
                    </div>
                </div>
            </div>
        ` : ''}

        <video id="screenShareVideo" style="display: none;" autoplay muted playsinline></video>

        <button class="profile-button" @click=${this.toggleSettings}>
          ${this.profilePhotoUri
            ? html`<img src=${this.profilePhotoUri} alt="Profile Photo" class="profile-avatar" />`
            : html`<svg class="profile-avatar-default" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
            </svg>`
          }
        </button>

        <div class="settings-panel ${this.isSettingsOpen ? 'open' : ''}">
          <div class="voice-selector">
            <label for="voice-select">Voice:</label>
            <select
              id="voice-select"
              @change=${this.handleVoiceChange}
              ?disabled=${this.isRecording}>
              ${this.voices.map(
                (voice) =>
                  html`<option
                    value=${voice}
                    ?selected=${this.selectedVoice === voice}>
                    ${voice}
                  </option>`,
              )}
            </select>
          </div>
          <button @click=${this.reset} ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="20px"
              viewBox="0 -960 960 960"
              width="20px"
              fill="#333333">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
            Reset Session
          </button>
          <button @click=${this.openCamera} ?disabled=${this.isRecording}>
            <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#333333"><path d="M480-260q75 0 127.5-52.5T660-440q0-75-52.5-127.5T480-620q-75 0-127.5 52.5T300-440q0 75 52.5 127.5T480-260Zm0-80q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29ZM160-120q-33 0-56.5-23.5T80-200v-480q0-33 23.5-56.5T160-760h120l80-80h240l80 80h120q33 0 56.5 23.5T880-680v480q0 33-23.5 56.5T800-120H160Zm0-80h640v-480H160v480Zm320-240Z"/></svg>
            Take Profile Photo
          </button>
          <button
              @click=${this.toggleScreenShare}
              ?disabled=${this.isRecording || !this.isScreenShareSupported}
              title=${!this.isScreenShareSupported ? 'Screen sharing is not supported by your browser.' : ''}
          >
              <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#333333"><path d="M200-120q-33 0-56.5-23.5T120-200v-360h80v360h480v-360h80v360q0 33-23.5 56.5T760-120H200Zm280-140L280-460l56-56 104 104v-328h80v328l104-104 56 56-200 200Z"/></svg>
              ${this.isSharingScreen ? 'Stop Sharing' : 'Share Screen'}
          </button>
          ${this.isSharingScreen ? html`
            <button @click=${this.togglePauseResumeScreenShare} ?disabled=${this.isRecording}>
                ${this.isScreenSharePaused 
                  ? html`<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#333333"><path d="M320-200v-560l440 280-440 280Z"/></svg>Resume Sharing` 
                  : html`<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="#333333"><path d="M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Z"/></svg>Pause Sharing`
                }
            </button>
          ` : ''}
        </div>

        <div id="status">
          ${this.error ? html`<span style="color: red;">${this.error}</span>` : this.status}
        </div>

        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}
        >
        </gdm-live-audio-visuals-3d>

        <div class="controls">
          <button @click=${this.isRecording ? this.stopRecording : this.startRecording}>
            ${this.isRecording
              ? html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#333333"><path d="M320-320v-320h320v320H320Z"/></svg>`
              : html`<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#333333"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35ZM280-280v-120h-80v120q0 100 60.5 174.5T440-40h80q99 0 169.5-65.5T760-280v-120h-80v120q0 66-47 113t-113 47q-66 0-113-47t-47-113Z"/></svg>`}
          </button>
        </div>
      </div>
    `;
  }
}