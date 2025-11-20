
/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state, query} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData, blobToBase64} from './utils.js';
import './visual-3d.js';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() isLiveConnected = false;
  @state() error = '';
  @state() selectedVoice = 'Zephyr';
  @state() profilePhotoUri: string | null = null;
  @state() isSharingScreen = false;
  @state() isStreamingScreenToLive = false;
  
  // New States for UI/UX
  @state() textInput = '';
  @state() textResponse: string | null = null;
  @state() isProcessingText = false;
  @state() showMenu = false;

  private client: GoogleGenAI;
  private sessionPromise: Promise<Session>;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
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
  private screenFrameInterval: number | null = null;

  @query('#screenShareVideo')
  screenShareVideo!: HTMLVideoElement;

  static styles = css`
    :host {
      display: block;
      font-family: 'Google Sans', Roboto, sans-serif;
      color: #1f1f1f;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    /* Background Orb */
    gdm-live-audio-visuals-3d {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    }

    /* Top Bar */
    .top-bar {
      position: absolute;
      top: 20px;
      left: 20px;
      right: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 20;
      pointer-events: none; /* Let clicks pass through */
    }

    .profile-button {
      pointer-events: auto;
      outline: none;
      border: 2px solid #fff;
      border-radius: 50%;
      background: #f0f0f0;
      width: 48px;
      height: 48px;
      cursor: pointer;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 0;
    }
    
    .profile-avatar {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    /* Bottom Input Bar */
    .bottom-bar-container {
      position: absolute;
      bottom: 30px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      z-index: 20;
      padding: 0 20px;
    }

    .input-bar {
      background: #f0f4f9;
      border-radius: 32px;
      display: flex;
      align-items: center;
      padding: 6px 8px;
      width: 100%;
      max-width: 700px;
      gap: 8px;
      transition: all 0.3s ease;
    }

    .input-bar:focus-within {
        background: #fff;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 10px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #444;
      transition: background 0.2s;
    }
    
    .icon-btn:hover {
      background: rgba(0,0,0,0.05);
    }

    .icon-btn.primary {
        background: #0b57d0;
        color: white;
    }
    .icon-btn.primary:hover {
        background: #0a4db6;
    }

    .input-field {
      flex: 1;
      border: none;
      outline: none;
      font-size: 16px;
      padding: 8px;
      color: #1f1f1f;
      background: transparent;
      font-family: inherit;
    }

    .mic-btn-active {
      background: #e8f0fe;
      color: #1a73e8;
    }

    .mic-pulse {
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.4); }
      70% { box-shadow: 0 0 0 10px rgba(26, 115, 232, 0); }
      100% { box-shadow: 0 0 0 0 rgba(26, 115, 232, 0); }
    }

    /* Response Card */
    .response-card {
      position: absolute;
      bottom: 100px; /* Above input bar */
      right: 20px; /* Align right like screenshot, or center if preferred */
      max-width: 400px; /* Similar to screenshot */
      width: calc(100% - 40px);
      background: #fff;
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.12);
      z-index: 15;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: slideUp 0.3s cubic-bezier(0.2, 0.0, 0.2, 1);
    }
    
    @media (min-width: 600px) {
        .response-card {
            right: 20px;
            left: auto;
            width: 400px;
        }
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: 16px;
      color: #1f1f1f;
      margin-bottom: 4px;
    }
    
    .card-title-group {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .card-content {
      font-size: 16px;
      line-height: 1.6;
      color: #333;
    }

    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 12px;
    }

    .sources-chip {
      border: 1px solid #c4c7c5;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #0b57d0;
      background: #fff;
      cursor: pointer;
      font-weight: 500;
    }
    
    .action-row {
        display: flex;
        gap: 8px;
    }
    
    .action-icon {
        color: #444;
        cursor: pointer;
        padding: 4px;
    }

    .disclaimer {
        font-size: 12px;
        color: #757575;
        margin-top: 12px;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Side Screen Controls */
    .side-controls {
      position: absolute;
      right: 20px;
      bottom: 180px; /* Moved up to allow space for response card on mobile */
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: flex-end;
      z-index: 15;
    }

    .pill-btn {
      background: #fff;
      border: none;
      padding: 12px 20px;
      border-radius: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 500;
      color: #1f1f1f;
      transition: transform 0.2s, background 0.2s;
    }

    .pill-btn:hover {
      background: #f8f9fa;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .pill-btn.active {
      background: #c2e7ff;
      color: #001d35;
    }

    /* Menu/Settings */
    .menu-popover {
      position: absolute;
      bottom: 90px;
      left: 20px;
      background: #fff;
      border-radius: 16px;
      padding: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 25;
      min-width: 200px;
    }

    .menu-item {
      background: none;
      border: none;
      padding: 12px 16px;
      text-align: left;
      cursor: pointer;
      border-radius: 12px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #1f1f1f;
    }

    .menu-item:hover {
      background: #f5f5f5;
    }

    .hidden { display: none; }
  `;

  constructor() {
    super();
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
  }

  private getSystemInstruction(): string {
    return `You are a helpful AI assistant. 
    If the user shares their screen, you can see it. Be helpful and provide assistance based on the content of the screen.
    The user can speak to you or type to you. 
    If they type, they expect a text response.
    If they speak, they expect a spoken response.`;
  }

  /**
   * Establishes the Live API connection for Audio/Voice interaction.
   */
  private async connectLiveSession() {
    if (this.sessionPromise) return this.sessionPromise;

    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';
    this.sessionPromise = this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          console.log('Session opened');
          this.isLiveConnected = true;
        },
        onmessage: async (message: LiveServerMessage) => {
          // Handle Audio Output
          const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
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
            this.nextStartTime += audioBuffer.duration;
            this.sources.add(source);
          }

          // Handle interruptions
          if (message.serverContent?.interrupted) {
            this.stopAudioPlayback();
          }
        },
        onerror: (e: ErrorEvent) => {
          console.error('Session error', e);
          this.updateError('Connection error.');
          this.isLiveConnected = false;
        },
        onclose: (e: CloseEvent) => {
          console.log('Session closed:', e.reason);
          this.isLiveConnected = false;
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {voiceName: this.selectedVoice},
          },
        },
        systemInstruction: this.getSystemInstruction(),
      },
    });

    return this.sessionPromise;
  }

  private stopAudioPlayback() {
    for (const source of this.sources.values()) {
      source.stop();
      this.sources.delete(source);
    }
    this.nextStartTime = 0;
  }

  private updateError(msg: string) {
    this.error = msg;
    setTimeout(() => this.error = '', 5000);
  }

  // --- Live Audio Interaction (Mic/Sparkle) ---

  private async toggleLiveMode() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.connectLiveSession(); // Ensure connection
      this.startRecording();
    }
  }

  private async startRecording() {
    if (this.isRecording) return;
    
    // Clear text response when starting voice
    this.textResponse = null; 
    this.inputAudioContext.resume();
    
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.sourceNode =
        this.inputAudioContext.createMediaStreamSource(this.mediaStream);
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
      this.updateError(`Microphone error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording) return;

    this.isRecording = false;
    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  // --- Text Interaction Handling ---

  private handleInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this.submitText();
    }
  }

  private async submitText(overrideText?: string) {
    const textToSubmit = overrideText || this.textInput;
    if (!textToSubmit.trim()) return;

    // UX: Reset Input, Clear previous response, Show loading
    this.textInput = '';
    this.textResponse = null;
    this.isProcessingText = true;

    // Stop voice if active (Hybrid behavior)
    if (this.isRecording) {
      this.stopRecording();
    }
    this.stopAudioPlayback();

    try {
      // Build request parts
      const parts: any[] = [{ text: textToSubmit }];

      // If user is sharing screen, attach a snapshot for context
      if (this.isSharingScreen) {
        const screenData = await this.captureScreenFrame();
        if (screenData) {
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: screenData
            }
          });
        }
      }

      // Use generateContent for Text-Only response
      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        // No audio modality
      });

      this.textResponse = response.text;

    } catch (e) {
      console.error(e);
      this.updateError('Failed to generate text response.');
    } finally {
      this.isProcessingText = false;
    }
  }

  // --- Screen Share Logic ---

  private async toggleScreenShare() {
    if (this.isSharingScreen) {
      this.stopScreenShare();
    } else {
      this.startScreenShare();
    }
  }

  private async startScreenShare() {
    // Allow attempt on all devices; cast to any to avoid strict TS checks on mobile environments
    const mediaDevices = navigator.mediaDevices as any;
    if (!mediaDevices || !mediaDevices.getDisplayMedia) {
      alert("Screen sharing is not supported on this device/browser.");
      return;
    }

    try {
      this.screenStream = await mediaDevices.getDisplayMedia({
        video: true,
      });
      this.isSharingScreen = true;
      this.showMenu = false;

      await this.updateComplete;
      if (this.screenShareVideo) {
        this.screenShareVideo.srcObject = this.screenStream;
        this.screenShareVideo.play();
      }

      this.screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

    } catch (err) {
      console.error('Screen share error:', err);
      this.isSharingScreen = false;
      // Don't alert on user cancellation, but log it
    }
  }

  private stopScreenShare() {
    this.stopFrameInterval();
    this.isStreamingScreenToLive = false;
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
    this.isSharingScreen = false;
  }

  // Toggles streaming screen frames to the Live Audio Session
  private async toggleShareScreenWithLive() {
    if (this.isStreamingScreenToLive) {
        this.stopFrameInterval();
        this.isStreamingScreenToLive = false;
    } else {
        // Ensure live session exists
        await this.connectLiveSession();
        this.startFrameInterval();
        this.isStreamingScreenToLive = true;
        
        // Auto-start mic if not already
        if (!this.isRecording) {
            this.startRecording();
        }
    }
  }

  private startFrameInterval() {
    this.stopFrameInterval();
    const sendFrame = async () => {
      if (!this.isSharingScreen) return;

      const base64Data = await this.captureScreenFrame();
      if (base64Data) {
        this.sessionPromise.then((session) => {
            session.sendRealtimeInput({
                media: {data: base64Data, mimeType: 'image/jpeg'},
            });
        });
      }
    };
    // 1 FPS for Live context is usually sufficient
    this.screenFrameInterval = window.setInterval(sendFrame, 1000); 
  }

  private stopFrameInterval() {
    if (this.screenFrameInterval) {
      clearInterval(this.screenFrameInterval);
      this.screenFrameInterval = null;
    }
  }

  private async captureScreenFrame(): Promise<string | null> {
    const videoEl = this.screenShareVideo;
    if (!videoEl || videoEl.paused || videoEl.ended || videoEl.videoWidth === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
        canvas.toBlob(async (blob) => {
            if (blob) {
                const base64 = await blobToBase64(blob);
                resolve(base64);
            } else {
                resolve(null);
            }
        }, 'image/jpeg', 0.6);
    });
  }

  private handleAskAboutScreen() {
    this.submitText("What is on my screen right now? Please explain.");
  }

  // --- Other UI Logic ---
  
  private toggleMenu() {
    this.showMenu = !this.showMenu;
  }

  private async takePhoto() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const video = document.createElement('video');
        video.srcObject = stream;
        video.play();
        await new Promise(r => setTimeout(r, 500));

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        
        const data = canvas.toDataURL('image/jpeg');
        localStorage.setItem('profilePhoto', data);
        this.profilePhotoUri = data;
        
        stream.getTracks().forEach(t => t.stop());
        this.showMenu = false;
      } catch(e) {
        alert("Camera permission needed");
      }
  }

  private copyResponse() {
      if (this.textResponse) {
          navigator.clipboard.writeText(this.textResponse);
      }
  }

  render() {
    // Check if user has typed something to show Send button
    const showSendButton = this.textInput.trim().length > 0;

    return html`
      <video id="screenShareVideo" style="display: none;" autoplay muted playsinline></video>
      
      <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}>
      </gdm-live-audio-visuals-3d>

      <!-- Top Bar -->
      <div class="top-bar">
        <div class="brand"></div>
        <button class="profile-button">
          ${this.profilePhotoUri
            ? html`<img src=${this.profilePhotoUri} class="profile-avatar" />`
            : html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>`}
        </button>
      </div>

      <!-- Text Response Card (Floating above input) -->
      ${this.textResponse ? html`
        <div class="response-card">
            <div class="card-header">
                <div class="card-title-group">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="url(#grad1)">
                        <defs>
                            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#4285F4;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#9B72CB;stop-opacity:1" />
                            </linearGradient>
                        </defs>
                        <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/>
                    </svg>
                    <span>Response</span>
                </div>
                <svg class="action-icon" @click=${() => this.textResponse = null} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </div>
            <div class="card-content">
                ${this.textResponse}
            </div>
            <div class="card-footer">
                <button class="sources-chip">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                    Sources
                </button>
                <div class="action-row">
                    <div class="action-icon" @click=${this.copyResponse}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </div>
                    <div class="action-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                    </div>
                </div>
            </div>
            <div class="disclaimer">Gemini can make mistakes, so double-check it</div>
        </div>
      ` : ''}

      <!-- Side Screen Controls -->
      ${this.isSharingScreen ? html`
        <div class="side-controls">
          <button class="pill-btn ${this.isStreamingScreenToLive ? 'active' : ''}" @click=${this.toggleShareScreenWithLive}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            Share screen with Live
          </button>
          <button class="pill-btn" @click=${this.handleAskAboutScreen}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            Ask about screen
          </button>
        </div>
      ` : ''}

      <!-- Bottom Menu Popover -->
      ${this.showMenu ? html`
        <div class="menu-popover">
            <button class="menu-item" @click=${this.takePhoto}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Camera / Profile
            </button>
            <button class="menu-item" @click=${this.toggleScreenShare}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                ${this.isSharingScreen ? 'Stop Sharing' : 'Share Screen'}
            </button>
        </div>
      ` : ''}

      <!-- Input Bar -->
      <div class="bottom-bar-container">
        <div class="input-bar">
            <button class="icon-btn" @click=${this.toggleMenu}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
            </button>
            
            <input 
                type="text" 
                class="input-field" 
                placeholder=${this.isProcessingText ? "Thinking..." : "Ask Gemini"} 
                .value=${this.textInput}
                @input=${(e: any) => this.textInput = e.target.value}
                @keydown=${this.handleInputKeydown}
                ?disabled=${this.isProcessingText}
            />

            ${showSendButton 
            ? html`
                <!-- Send Button (Visible when typing) -->
                <button class="icon-btn primary" @click=${() => this.submitText()}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="12" y1="19" x2="12" y2="5"></line>
                        <polyline points="5 12 12 5 19 12"></polyline>
                    </svg>
                </button>
            ` 
            : html`
                <!-- Mic and Live Buttons (Visible when idle) -->
                <button class="icon-btn ${this.isRecording ? 'mic-btn-active' : ''}" @click=${this.toggleLiveMode}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                </button>
                <button class="icon-btn" @click=${this.toggleLiveMode}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                        <path d="M3 3v5h5"></path>
                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
                        <path d="M16 21h5v-5"></path>
                    </svg>
                </button>
            `}
        </div>
      </div>
    `;
  }
}
