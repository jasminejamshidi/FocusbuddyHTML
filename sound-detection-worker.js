self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

let audioContext;
let analyser;
let isListening = true;

async function startContinuousListening() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                continuous: true
            }
        });

        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        // Keep processing audio
        processAudio();
    } catch (error) {
        console.error('Error starting continuous listening:', error);
    }
}

function processAudio() {
    if (!isListening) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // Send audio data to main thread
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'audioData',
                data: Array.from(dataArray)
            });
        });
    });

    requestAnimationFrame(processAudio);
}

self.addEventListener('message', (event) => {
    if (event.data.type === 'startListening') {
        startContinuousListening();
    }
}); 