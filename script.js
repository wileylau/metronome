class Metronome {
    constructor() {
        this.bpm = 120;
        this.isPlaying = false;
        this.audioContext = null;
        this.isDragging = false;
        this.lastAngle = 0;
        this.lastBpm = 120;
        
        this.nextBeatTime = 0;
        this.lookahead = 25.0;
        this.scheduleAheadTime = 0.1;
        this.timerWorker = null;
        this.beatQueue = [];
        this.bpmInput = document.getElementById('bpmInput');
        this.bpmDisplay = document.getElementById('bpmDisplay');
        this.beatIndicator = document.getElementById('beatIndicator');
        this.startStopBtn = document.getElementById('startStopBtn');
        this.dial = document.getElementById('bpmDial');
        this.dialKnob = document.getElementById('dialKnob');
        
        this.init();
    }
    
    init() {
        this.updateDisplay();
        this.updateDialPosition();
        this.bindEvents();
        this.initAudioContext();
        this.initTimerWorker();
    }
    
    initAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            console.warn('Web Audio API not supported, falling back to visual-only metronome');
        }
    }
    
    initTimerWorker() {
        const workerScript = `
            let timerID = null;
            let interval = 100;
            
            self.onmessage = function(e) {
                if (e.data === "start") {
                    timerID = setInterval(() => self.postMessage("tick"), interval);
                } else if (e.data === "stop") {
                    clearInterval(timerID);
                    timerID = null;
                } else if (e.data.interval) {
                    interval = e.data.interval;
                    if (timerID) {
                        clearInterval(timerID);
                        timerID = setInterval(() => self.postMessage("tick"), interval);
                    }
                }
            };
        `;
        
        try {
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            this.timerWorker = new Worker(URL.createObjectURL(blob));
            this.timerWorker.onmessage = () => this.scheduler();
        } catch (error) {
            console.warn('Web Worker not supported, using fallback timing');
        }
    }
    
    bindEvents() {
        this.startStopBtn.addEventListener('click', () => this.toggleMetronome());
        
        this.bpmInput.addEventListener('input', (e) => this.handleBpmInput(e));
        this.bpmInput.addEventListener('keydown', (e) => this.handleBpmKeydown(e));
        this.bpmInput.addEventListener('focus', () => this.bpmInput.select());
        this.bpmInput.addEventListener('blur', () => this.validateBpmInput());
        
        this.dial.addEventListener('mousedown', (e) => this.handleDialInteraction(e));
        this.dial.addEventListener('touchstart', (e) => this.handleDialInteraction(e), { passive: false });
        
        document.addEventListener('mousemove', (e) => this.drag(e));
        document.addEventListener('touchmove', (e) => this.drag(e), { passive: false });
        
        document.addEventListener('mouseup', () => this.stopDrag());
        document.addEventListener('touchend', () => this.stopDrag());
        
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.bpmInput.matches(':focus')) {
                e.preventDefault();
                this.toggleMetronome();
            }
        });
    }
    
    handleDialInteraction(e) {
        const rect = this.dial.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        
        const clickX = clientX - centerX;
        const clickY = clientY - centerY;
        const distance = Math.sqrt(clickX * clickX + clickY * clickY);
        
        const dialRadius = 100;
        const knobRadius = 70;
        
        if (distance > knobRadius && distance <= dialRadius) {
            this.setBPMFromAngle(clickX, clickY);
        } else {
            this.startDrag(e);
        }
    }
    
    setBPMFromAngle(x, y) {
        let angle = Math.atan2(y, x);
        
        let degrees = (angle * 180 / Math.PI + 360) % 360;
        
        degrees = (degrees + 90) % 360;
        
        if (degrees > 270) {
            degrees = degrees > 315 ? 0 : 270;
        }
        
        const bpmRange = 240 - 60;
        const newBpm = 60 + (degrees / 270) * bpmRange;
        
        this.setBPM(newBpm);
        this.playDetentClick();
    }
    
    startDrag(e) {
        this.isDragging = true;
        this.dial.style.cursor = 'grabbing';
        
        const rect = this.dial.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        
        this.lastAngle = Math.atan2(clientY - centerY, clientX - centerX);
        
        e.preventDefault();
    }
    
    drag(e) {
        if (!this.isDragging) return;
        
        const rect = this.dial.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        
        const currentAngle = Math.atan2(clientY - centerY, clientX - centerX);
        const angleDiff = currentAngle - this.lastAngle;
        
        let normalizedDiff = angleDiff;
        if (normalizedDiff > Math.PI) normalizedDiff -= 2 * Math.PI;
        if (normalizedDiff < -Math.PI) normalizedDiff += 2 * Math.PI;
        
        const bpmChange = (normalizedDiff / Math.PI) * 25;
        const newBpm = Math.max(60, Math.min(240, this.bpm + bpmChange));
        
        const oldBpmRounded = Math.round(this.bpm);
        const newBpmRounded = Math.round(newBpm);
        
        if (oldBpmRounded !== newBpmRounded) {
            this.playDetentClick();
        }
        
        this.setBPM(newBpm);
        this.lastAngle = currentAngle;
        
        e.preventDefault();
    }
    
    stopDrag() {
        this.isDragging = false;
        this.dial.style.cursor = 'pointer';
    }
    
    setBPM(newBPM) {
        const oldBpm = this.bpm;
        this.bpm = Math.max(60, Math.min(240, Math.round(newBPM)));
        this.updateDisplay();
        this.updateDialPosition();
        
        if (this.isPlaying && oldBpm !== this.bpm) {
            this.resynchronize();
        }
    }
    
    updateDisplay() {
        this.bpmInput.value = this.bpm;
    }
    
    handleBpmInput(e) {
        const value = e.target.value;
        const numValue = parseInt(value);
        
        if (!isNaN(numValue) && numValue >= 60 && numValue <= 240) {
            this.bpm = numValue;
            this.updateDialPosition();
            
            if (this.isPlaying) {
                this.resynchronize();
            }
        }
    }
    
    handleBpmKeydown(e) {
        if (e.key === 'Enter') {
            this.validateBpmInput();
            this.bpmInput.blur();
        } else if (e.key === 'Escape') {
            this.bpmInput.value = this.bpm;
            this.bpmInput.blur();
        }
    }
    
    validateBpmInput() {
        const value = parseInt(this.bpmInput.value);
        if (isNaN(value) || value < 60 || value > 240) {
            this.bpmInput.value = this.bpm;
        } else {
            this.setBPM(value);
        }
    }
    
    updateDialPosition() {
        const angle = ((this.bpm - 60) / (240 - 60)) * 270;
        this.dialKnob.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    }
    
    toggleMetronome() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.start();
        }
    }
    
    start() {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.startStopBtn.classList.add('active');
        this.startStopBtn.querySelector('.btn-text').textContent = 'STOP';
        
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        this.nextBeatTime = this.audioContext ? this.audioContext.currentTime : Date.now() / 1000;
        this.beatQueue = [];
        
        if (this.timerWorker) {
            this.timerWorker.postMessage("start");
        } else {
            this.schedulerInterval = setInterval(() => this.scheduler(), this.lookahead);
        }
    }
    
    stop() {
        if (!this.isPlaying) return;
        
        this.isPlaying = false;
        this.startStopBtn.classList.remove('active');
        this.startStopBtn.querySelector('.btn-text').textContent = 'START';
        
        if (this.timerWorker) {
            this.timerWorker.postMessage("stop");
        } else if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
        
        this.beatQueue = [];
        this.beatIndicator.classList.remove('active');
    }
    
    resynchronize() {
        if (!this.isPlaying) return;
        
        const currentTime = this.audioContext ? this.audioContext.currentTime : Date.now() / 1000;
        this.nextBeatTime = currentTime + (60 / this.bpm);
        this.beatQueue = [];
    }
    
    scheduler() {
        const currentTime = this.audioContext ? this.audioContext.currentTime : Date.now() / 1000;
        
        while (this.nextBeatTime < currentTime + this.scheduleAheadTime) {
            this.scheduleBeat(this.nextBeatTime);
            this.nextBeatTime += 60 / this.bpm;
        }
    }
    
    scheduleBeat(time) {
        this.beatQueue.push({ time: time });
        
        if (this.audioContext) {
            this.scheduleClickSound(time);
        }
        
        const delay = (time - (this.audioContext ? this.audioContext.currentTime : Date.now() / 1000)) * 1000;
        setTimeout(() => this.showBeatIndicator(), Math.max(0, delay));
    }
    
    showBeatIndicator() {
        this.beatIndicator.classList.add('active');
        setTimeout(() => {
            this.beatIndicator.classList.remove('active');
        }, 150);
    }
    
    scheduleClickSound(time) {
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const filterNode = this.audioContext.createBiquadFilter();
            
            oscillator.connect(filterNode);
            filterNode.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.setValueAtTime(1000, time);
            oscillator.frequency.exponentialRampToValueAtTime(100, time + 0.08);
            
            filterNode.type = 'highpass';
            filterNode.frequency.setValueAtTime(200, time);
            
            gainNode.gain.setValueAtTime(0, time);
            gainNode.gain.linearRampToValueAtTime(0.2, time + 0.005);
            gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
            
            oscillator.start(time);
            oscillator.stop(time + 0.08);
        } catch (error) {
            console.warn('Audio playback failed:', error);
        }
    }
    
    playDetentClick() {
        if (!this.audioContext) return;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const filterNode = this.audioContext.createBiquadFilter();
            
            oscillator.connect(filterNode);
            filterNode.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            oscillator.frequency.setValueAtTime(2000, this.audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(500, this.audioContext.currentTime + 0.02);
            
            filterNode.type = 'bandpass';
            filterNode.frequency.setValueAtTime(1500, this.audioContext.currentTime);
            filterNode.Q.setValueAtTime(5, this.audioContext.currentTime);
            
            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.05, this.audioContext.currentTime + 0.002);
            gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.02);
            
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + 0.02);
        } catch (error) {
            console.warn('Detent click playback failed:', error);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new Metronome();
});