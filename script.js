let video, canvas, ctx;
let model;
let isMonitoring = false;
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let lastFrame = null;
let recordingStartTime;
let recordingInterval;

const MOTION_THRESHOLD = 30; // Adjust sensitivity
const RECORDING_DURATION = 5 * 60 * 1000; // 5 minutes

document.getElementById('startBtn').addEventListener('click', startMonitoring);

async function startMonitoring() {
    const serverUrl = document.getElementById('serverUrl').value;
    if (!serverUrl) {
        alert('Please enter your PC server address!');
        return;
    }
    
    video = document.getElementById('video');
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');
    
    // Get camera access
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' } // Use back camera
        });
        video.srcObject = stream;
        
        // Wait for video to load
        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
        });
        
        // Load AI model
        updateStatus('Loading AI model...');
        model = await cocoSsd.load();
        updateStatus('Monitoring for motion...');
        
        isMonitoring = true;
        document.getElementById('startBtn').disabled = true;
        detectMotion();
        
    } catch (error) {
        alert('Camera access denied! ' + error.message);
    }
}

function detectMotion() {
    if (!isMonitoring) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    if (lastFrame && !isRecording) {
        const motionDetected = compareFrames(currentFrame, lastFrame);
        
        if (motionDetected) {
            startRecording();
        }
    }
    
    if (isRecording) {
        detectAndDrawObjects();
    }
    
    lastFrame = currentFrame;
    requestAnimationFrame(detectMotion);
}

function compareFrames(frame1, frame2) {
    let diffCount = 0;
    const data1 = frame1.data;
    const data2 = frame2.data;
    
    // Sample every 10th pixel for performance
    for (let i = 0; i < data1.length; i += 40) {
        const diff = Math.abs(data1[i] - data2[i]);
        if (diff > MOTION_THRESHOLD) {
            diffCount++;
        }
    }
    
    const totalSampled = data1.length / 40;
    const motionPercentage = (diffCount / totalSampled) * 100;
    
    return motionPercentage > 2; // 2% of pixels changed
}

async function detectAndDrawObjects() {
    const predictions = await model.detect(canvas);
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    predictions.forEach(prediction => {
        const [x, y, width, height] = prediction.bbox;
        
        // Draw green box
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, width, height);
        
        // Draw label
        ctx.fillStyle = '#00ff00';
        ctx.font = '18px Arial';
        ctx.fillText(
            `${prediction.class} ${Math.round(prediction.score * 100)}%`,
            x,
            y > 20 ? y - 5 : y + 20
        );
    });
}

function startRecording() {
    isRecording = true;
    recordedChunks = [];
    recordingStartTime = Date.now();
    
    updateStatus('🔴 RECORDING!', true);
    
    const stream = canvas.captureStream(30); // 30 FPS
    mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9'
    });
    
    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };
    
    mediaRecorder.onstop = uploadRecording;
    
    mediaRecorder.start();
    
    // Update recording time display
    recordingInterval = setInterval(updateRecordingTime, 1000);
    
    // Stop after 5 minutes
    setTimeout(() => {
        stopRecording();
    }, RECORDING_DURATION);
}

function stopRecording() {
    isRecording = false;
    clearInterval(recordingInterval);
    mediaRecorder.stop();
    updateStatus('Uploading video...');
}

function updateRecordingTime() {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    document.getElementById('recordingTime').textContent = 
        `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function uploadRecording() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const serverUrl = document.getElementById('serverUrl').value;
    
    const formData = new FormData();
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    formData.append('video', blob, `recording_${timestamp}.webm`);
    
    try {
        const response = await fetch(`http://${serverUrl}/upload`, {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            updateStatus('✅ Video uploaded! Monitoring resumed...');
            document.getElementById('recordingTime').textContent = '--';
        } else {
            updateStatus('❌ Upload failed. Monitoring resumed...');
        }
    } catch (error) {
        updateStatus('❌ Cannot reach PC: ' + error.message);
    }
}

function updateStatus(text, isRecordingState = false) {
    const statusText = document.getElementById('statusText');
    statusText.textContent = text;
    statusText.className = isRecordingState ? 'recording' : '';
}
