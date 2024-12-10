const MODELS = {
    doorLock: {
        url: "https://teachablemachine.withgoogle.com/models/4JaX5pjX6/",
        recognizer: null,
        active: true
    },
    waterSound: {
        url: "https://teachablemachine.withgoogle.com/models/HMHHWzV40/",
        recognizer: null,
        active: true
    }
};

let audioContext;
let analyser;
let isListening = true; // Always true
let audioStream = null;

// Add these variables at the top
let wakeLock = null;
let retryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 5000; // 5 seconds

// Add these variables for custom reminders
let customReminders = [];

// Add preset reminders configuration
const PRESET_REMINDERS = {
    vitamins: {
        title: "Take Vitamins",
        message: "Time to take your daily vitamins!",
        icon: "medication",
        type: "info",
        defaultTime: "09:00"
    },
    laundry: {
        title: "Laundry Time",
        message: "Time to do your laundry",
        icon: "local_laundry_service",
        type: "info",
        defaultTime: "10:00"
    },
    groceries: {
        title: "Groceries Shopping",
        message: "Time to buy groceries",
        icon: "shopping_cart",
        type: "info",
        defaultTime: "11:00"
    }
};

// Add this at the top of your file
let notificationPermissionGranted = false;

async function init() {
    try {
        // Request notification permission first
        if ("Notification" in window) {
            const permission = await Notification.requestPermission();
            notificationPermissionGranted = permission === "granted";
            console.log('Notification permission:', permission);
        }

        // Initialize audio context and start listening
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;

        await createModels();
        await startContinuousListening();
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

// Simplify the notification function
function sendNotification(title, message) {
    if (!notificationPermissionGranted) {
        console.log('Notifications not permitted');
        return;
    }

    try {
        const notification = new Notification(title, {
            body: message,
            icon: '/icons/water-icon.png', // Make sure this path is correct
            requireInteraction: true
        });

        // Log for debugging
        console.log('Notification sent:', { title, message });

        // Add notification event listeners
        notification.onclick = () => {
            window.focus();
            notification.close();
            console.log('Notification clicked');
        };

        notification.onshow = () => {
            console.log('Notification shown');
        };

        notification.onerror = (error) => {
            console.error('Notification error:', error);
        };

    } catch (error) {
        console.error('Error creating notification:', error);
    }
}

// Update the startModelListening function
async function startModelListening(modelType) {
    const model = MODELS[modelType];
    if (!model.recognizer) return;

    try {
        await model.recognizer.listen(
            result => {
                const scores = result.scores;
                updateConfidenceDisplay(modelType, scores);
                
                const targetScore = scores[1];
                const backgroundScore = scores[0];
                const total = targetScore + backgroundScore;
                const percentage = total > 0 ? (targetScore / total) * 100 : 0;
                
                console.log(`${modelType} detection: ${percentage.toFixed(1)}%`);

                // Send notification for water detection (30-40% confidence)
                if (modelType === 'waterSound' && 
                    percentage >= 30 && percentage <= 40) {
                    sendNotification(
                        "Water Detected",
                        `Water sound detected (${percentage.toFixed(1)}% confidence)`
                    );
                    console.log('Water detection triggered notification');
                }
            },
            {
                includeSpectrogram: true,
                probabilityThreshold: 0.3,
                invokeCallbackOnNoiseAndUnknown: true,
                overlapFactor: 0.50
            }
        );
    } catch (error) {
        console.error(`Error in ${modelType} listening:`, error);
    }
}

// Enhanced wake lock function
async function keepDeviceAwake() {
    try {
        if ('wakeLock' in navigator) {
            // Release existing wake lock if any
            if (wakeLock) {
                await wakeLock.release();
            }

            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock activated');

            // Handle wake lock release
            wakeLock.addEventListener('release', async () => {
                console.log('Wake Lock released - attempting to reacquire');
                await reacquireWakeLock();
            });

            // Set up visibility change handler
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }
    } catch (error) {
        console.error('Wake Lock error:', error);
        await handleWakeLockError();
    }
}

// Handle visibility changes
async function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        await reacquireWakeLock();
        await resumeAudioContext();
    }
}

// Reacquire wake lock with retry logic
async function reacquireWakeLock(attempt = 0) {
    try {
        if (document.visibilityState === 'visible') {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock reacquired');
            retryAttempts = 0; // Reset retry counter on success
        }
    } catch (error) {
        console.error('Error reacquiring wake lock:', error);
        if (attempt < MAX_RETRY_ATTEMPTS) {
            console.log(`Retrying wake lock acquisition... (${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);
            setTimeout(() => reacquireWakeLock(attempt + 1), RETRY_DELAY);
        } else {
            showDeviceNotification(
                "Warning",
                "Unable to keep device awake. Sound detection may be interrupted.",
                "warning"
            );
        }
    }
}

// Handle wake lock errors
async function handleWakeLockError() {
    if (retryAttempts < MAX_RETRY_ATTEMPTS) {
        retryAttempts++;
        console.log(`Retrying wake lock... (${retryAttempts}/${MAX_RETRY_ATTEMPTS})`);
        setTimeout(keepDeviceAwake, RETRY_DELAY);
    } else {
        showDeviceNotification(
            "Warning",
            "Device may go to sleep. Keep the app in foreground for best results.",
            "warning"
        );
    }
}

// Enhanced audio context recovery
async function resumeAudioContext() {
    try {
        if (audioContext?.state === 'suspended') {
            await audioContext.resume();
            console.log('Audio context resumed');
            
            // Restart sound detection if needed
            if (!isListening) {
                await startListening();
            }
        }
    } catch (error) {
        console.error('Error resuming audio context:', error);
        await handleAudioError();
    }
}

// Handle audio errors
async function handleAudioError(attempt = 0) {
    try {
        if (attempt < MAX_RETRY_ATTEMPTS) {
            console.log(`Attempting to recover audio... (${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);
            
            // Recreate audio context
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            
            // Restart audio processing
            await startListening();
        } else {
            showDeviceNotification(
                "Error",
                "Sound detection error. Please refresh the page.",
                "error"
            );
        }
    } catch (error) {
        console.error('Error recovery failed:', error);
        if (attempt < MAX_RETRY_ATTEMPTS) {
            setTimeout(() => handleAudioError(attempt + 1), RETRY_DELAY);
        }
    }
}

// Add system health check
function checkSystemHealth() {
    if (audioContext?.state !== 'running') {
        resumeAudioContext();
    }
    if (!audioStream || audioStream.active === false) {
        startContinuousListening();
    }
    if (!wakeLock) {
        reacquireWakeLock();
    }
}

// Handle system errors
async function handleSystemError(error) {
    console.error('System error:', error);
    
    // Try to recover automatically
    try {
        if (audioContext) {
            await audioContext.close();
        }
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        await startContinuousListening();
    } catch (retryError) {
        console.error('Recovery failed:', retryError);
        showDeviceNotification(
            "Error",
            "Sound detection error. Please refresh the page.",
            "error"
        );
    }
}

// Rest of your existing code...

async function startListening() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        // Start models listening
        await Promise.all([
            startModelListening('doorLock'),
            startModelListening('waterSound')
        ]);

        // Update UI to show active state
        const startButton = document.getElementById('startButton');
        startButton.innerHTML = '<span class="material-icons">mic_off</span>Stop Detection';
        startButton.classList.add('active');
    } catch (error) {
        console.error('Error starting listeners:', error);
    }
}

// Update toggleListening to only handle UI
function toggleListening() {
    // Do nothing - sound detection is always on
    return;
}

// Add page visibility handling
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        if (audioContext?.state === 'suspended') {
            await resumeAudioContext();
        }
        if (!audioStream || audioStream.active === false) {
            await startContinuousListening();
        }
    }
});

// Handle page unload
window.addEventListener('beforeunload', async (event) => {
    // Try to prevent closing
    event.preventDefault();
    event.returnValue = 'Sound detection is running. Are you sure you want to close?';
    
    // Attempt to restart if user stays
    setTimeout(async () => {
        if (!audioStream || audioStream.active === false) {
            await startContinuousListening();
        }
    }, 1000);
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', init);

// Update cleanup
function cleanup() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
}

// Update beforeunload handler
window.addEventListener('beforeunload', (event) => {
    cleanup();
    event.preventDefault();
    event.returnValue = '';
});

// Add this function to handle model detection
async function startModelListening(modelType) {
    const model = MODELS[modelType];
    if (!model.recognizer) return;

    try {
        await model.recognizer.listen(
            result => {
                const scores = result.scores;
                updateConfidenceDisplay(modelType, scores);
                
                const targetScore = scores[1];
                const backgroundScore = scores[0];
                const total = targetScore + backgroundScore;
                const percentage = total > 0 ? (targetScore / total) * 100 : 0;
                
                // Add debug logging
                debugLog(`${modelType} detection: ${percentage.toFixed(1)}%`);
                updateLastDetected(modelType, percentage);

                // Trigger notifications for water sound between 70-100%
                if (modelType === 'waterSound' && percentage >= 70 && percentage <= 100) {
                    triggerNotification(
                        "Water Running",
                        `Water detected (${percentage.toFixed(1)}% confidence)`,
                        "info"
                    );
                    
                    // Update UI to show high confidence
                    const waterStatus = document.getElementById('waterLastDetected');
                    if (waterStatus) {
                        const timestamp = new Date().toLocaleTimeString();
                        waterStatus.innerHTML = `
                            <strong style="color: var(--success)">Active Detection</strong><br>
                            Last detected: ${timestamp} (${percentage.toFixed(1)}%)
                        `;
                    }
                }
            },
            {
                includeSpectrogram: true,
                probabilityThreshold: 0.70, // Lower threshold to match our 70% requirement
                invokeCallbackOnNoiseAndUnknown: true,
                overlapFactor: 0.50
            }
        );
        debugLog(`Started listening for ${modelType} sounds`);
    } catch (error) {
        debugLog(`Error in ${modelType} listening: ${error.message}`);
        console.error(`Error in ${modelType} listening:`, error);
    }
}

// Update the updateConfidenceDisplay function to match our thresholds
function updateConfidenceDisplay(modelType, scores) {
    const confidenceElement = modelType === 'doorLock' ? 
        document.getElementById('doorLockConfidence') :
        document.getElementById('waterConfidence');
    
    const percentageElement = modelType === 'doorLock' ? 
        document.getElementById('doorLockPercentage') :
        document.getElementById('waterPercentage');
    
    if (confidenceElement && percentageElement) {
        const targetScore = scores[1];
        const backgroundScore = scores[0];
        const total = targetScore + backgroundScore;
        const percentage = total > 0 ? (targetScore / total) * 100 : 0;
        
        confidenceElement.style.width = `${percentage}%`;
        percentageElement.textContent = `${percentage.toFixed(1)}%`;

        // Update color based on confidence levels
        if (percentage >= 30 && percentage <= 40) {
            confidenceElement.style.background = 'var(--success)'; // Target range
        } else if (percentage > 40) {
            confidenceElement.style.background = 'var(--primary)'; // Above range
        } else {
            confidenceElement.style.background = '#666'; // Below range
        }
    }
}

// Add function to create models
async function createModels() {
    try {
        await Promise.all([
            initializeModel('doorLock'),
            initializeModel('waterSound')
        ]);
        console.log("Models loaded successfully");
    } catch (error) {
        console.error("Error loading models:", error);
        throw error;
    }
}

// Add function to initialize individual model
async function initializeModel(modelType) {
    const model = MODELS[modelType];
    const checkpointURL = model.url + "model.json";
    const metadataURL = model.url + "metadata.json";

    try {
        model.recognizer = speechCommands.create(
            "BROWSER_FFT",
            undefined,
            checkpointURL,
            metadataURL,
            {
                sampleRateHz: 44100,
                fftSize: 1024
            }
        );
        await model.recognizer.ensureModelLoaded();
        console.log(`${modelType} model loaded successfully`);
    } catch (error) {
        console.error(`Error loading ${modelType} model:`, error);
        throw error;
    }
}

// Update startListening function to include model listening
async function startListening() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        // Start models listening
        await Promise.all([
            startModelListening('doorLock'),
            startModelListening('waterSound')
        ]);

        // Update UI
        const startButton = document.getElementById('startButton');
        startButton.innerHTML = '<span class="material-icons">mic_off</span>Stop Detection';
        startButton.classList.add('active');
    } catch (error) {
        console.error('Error starting listeners:', error);
        handleSystemError(error);
    }
}

// New continuous listening function
async function startContinuousListening() {
    try {
        // Create audio context first if needed
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
        }

        // Get audio stream
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 44100
            }
        });

        // Connect audio nodes
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);

        // Start models listening
        await Promise.all([
            startModelListening('doorLock'),
            startModelListening('waterSound')
        ]);

        console.log('Continuous listening started');
    } catch (error) {
        console.error('Error starting continuous listening:', error);
        await handleSystemError(error);
    }
}

// Add this function to handle notifications
async function initializeNotifications() {
    try {
        // Request notification permission
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            console.log('Notification permission:', permission);
            
            if (permission === 'granted') {
                // Register service worker for notifications
                if ('serviceWorker' in navigator) {
                    const registration = await navigator.serviceWorker.register('notification-worker.js');
                    console.log('Service Worker registered for notifications');
                }
            } else {
                console.warn('Notification permission denied');
            }
        }
    } catch (error) {
        console.error('Error initializing notifications:', error);
    }
}

// Update the showDeviceNotification function
async function showDeviceNotification(title, message, type) {
    try {
        if (Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return;
        }

        const options = {
            body: message,
            icon: type === 'warning' ? '/icons/key-icon.png' : '/icons/water-icon.png',
            badge: '/icons/notification-badge.png',
            tag: `sound-detection-${Date.now()}`,
            requireInteraction: true,
            silent: false,
            vibrate: [200, 100, 200],
            actions: [
                {
                    action: 'open',
                    title: 'Open App'
                },
                {
                    action: 'dismiss',
                    title: 'Dismiss'
                }
            ]
        };

        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification(title, options);
            console.log('Notification sent:', { title, message, type });
        } else {
            new Notification(title, options);
        }
    } catch (error) {
        console.error('Error showing notification:', error);
    }
}

// Add this function to handle notification triggering
async function triggerNotification(title, message, type) {
    try {
        // Check permission
        if (Notification.permission !== "granted") {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                debugLog("Notification permission denied");
                return;
            }
        }

        // Create and show notification
        const notification = new Notification(title, {
            body: message,
            icon: type === 'warning' ? '/icons/key-icon.png' : '/icons/water-icon.png',
            tag: `sound-detection-${Date.now()}`,
            requireInteraction: true,
            vibrate: [200, 100, 200]
        });

        debugLog(`Notification sent: ${title} - ${message}`);

        // Log notification events
        notification.addEventListener('show', () => debugLog(`Notification shown: ${title}`));
        notification.addEventListener('error', (e) => debugLog(`Notification error: ${e}`));
        notification.addEventListener('click', () => debugLog(`Notification clicked: ${title}`));
        notification.addEventListener('close', () => debugLog(`Notification closed: ${title}`));

    } catch (error) {
        debugLog(`Error sending notification: ${error.message}`);
        console.error('Notification error:', error);
    }
}

// Add notification retry logic
async function retryNotification(title, message, type, maxRetries = 3) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            await triggerNotification(title, message, type);
            return; // Success
        } catch (error) {
            console.error(`Notification retry ${retries + 1} failed:`, error);
            retries++;
            if (retries === maxRetries) {
                console.error('Max notification retries reached');
            } else {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            }
        }
    }
}

// Add this notification initialization function
async function requestNotificationPermission() {
    if (!("Notification" in window)) {
        console.error("This browser does not support notifications.");
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            console.log("Notification permission granted.");
            await registerNotificationServiceWorker();
            return true;
        } else {
            console.warn("Notification permission denied.");
            return false;
        }
    } catch (error) {
        console.error("Error requesting notification permission:", error);
        return false;
    }
}

// Add service worker registration
async function registerNotificationServiceWorker() {
    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.register('notification-worker.js');
            console.log('Notification Service Worker registered:', registration);
            return registration;
        }
    } catch (error) {
        console.error('Service Worker registration failed:', error);
        throw error;
    }
}

// Update the scheduled reminders function
function startScheduledReminders() {
    // Water reminder every 2 hours
    waterReminderInterval = setInterval(() => {
        if (activeReminders.water) {
            triggerNotification(
                "Hydration Time",
                "Remember to stay hydrated! Take a water break.",
                "info"
            );
        }
    }, 2 * 60 * 60 * 1000); // 2 hours

    // Keys reminder at 8 AM and 6 PM
    function scheduleKeysReminder() {
        const now = new Date();
        const morning = new Date(now);
        morning.setHours(8, 0, 0, 0);
        const evening = new Date(now);
        evening.setHours(18, 0, 0, 0);

        if (activeReminders.doorLock) {
            if (now.getHours() < 8) {
                setTimeout(() => {
                    triggerNotification(
                        "Morning Key Check",
                        "Starting your day? Don't forget your keys!",
                        "warning"
                    );
                }, morning - now);
            } else if (now.getHours() < 18) {
                setTimeout(() => {
                    triggerNotification(
                        "Evening Key Check",
                        "Heading out? Remember to take your keys!",
                        "warning"
                    );
                }, evening - now);
            }
        }
    }

    scheduleKeysReminder();
    // Run schedule check daily
    setInterval(scheduleKeysReminder, 24 * 60 * 60 * 1000);
}

// Clean up intervals on page unload
window.addEventListener('beforeunload', () => {
    if (waterReminderInterval) clearInterval(waterReminderInterval);
});

// Function to create custom reminder
async function createCustomReminder() {
    const title = document.getElementById('reminderTitle').value;
    const message = document.getElementById('reminderMessage').value;
    const type = document.getElementById('reminderType').value;
    const time = document.getElementById('reminderTime').value;

    if (!title || !message || !time) {
        triggerNotification(
            "Error",
            "Please fill in all fields",
            "error"
        );
        return;
    }

    const reminder = {
        id: Date.now(),
        title,
        message,
        type,
        time,
        active: true
    };

    customReminders.push(reminder);
    scheduleCustomReminder(reminder);
    saveCustomReminders();
    updateCustomRemindersList();
    clearCustomReminderForm();

    triggerNotification(
        "Reminder Created",
        `Reminder "${title}" set for ${time}`,
        "info"
    );
}

// Function to schedule custom reminder
function scheduleCustomReminder(reminder) {
    const [hours, minutes] = reminder.time.split(':');
    const now = new Date();
    const reminderTime = new Date(now);
    reminderTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    if (reminderTime < now) {
        reminderTime.setDate(reminderTime.getDate() + 1);
    }

    const timeUntilReminder = reminderTime - now;
    setTimeout(() => {
        if (reminder.active) {
            triggerNotification(
                reminder.title,
                reminder.message,
                reminder.type
            );
            // Schedule next day's reminder
            scheduleCustomReminder(reminder);
        }
    }, timeUntilReminder);
}

// Function to update custom reminders list
function updateCustomRemindersList() {
    const list = document.getElementById('customRemindersList');
    list.innerHTML = '';

    customReminders.forEach(reminder => {
        // Convert 24-hour time to 12-hour format
        const [hours24, minutes] = reminder.time.split(':');
        let hours12 = parseInt(hours24);
        const period = hours12 >= 12 ? 'PM' : 'AM';
        
        if (hours12 > 12) {
            hours12 -= 12;
        } else if (hours12 === 0) {
            hours12 = 12;
        }

        const displayTime = `${hours12}:${minutes} ${period}`;

        const reminderElement = document.createElement('div');
        reminderElement.className = 'custom-reminder-item';
        reminderElement.innerHTML = `
            <div class="reminder-info">
                <span class="material-icons">${reminder.icon || 'notifications'}</span>
                <h3>${reminder.title}</h3>
                <span class="reminder-time">${displayTime}</span>
            </div>
            <div class="reminder-controls">
                <label class="switch">
                    <input type="checkbox" 
                           ${reminder.active ? 'checked' : ''} 
                           onchange="toggleCustomReminder(${reminder.id}, this.checked)">
                    <span class="slider"></span>
                </label>
                <div class="reminder-actions">
                    <button onclick="editReminder(${reminder.id})" class="edit-btn">
                        <span class="material-icons">edit</span>
                    </button>
                    <button onclick="deleteCustomReminder(${reminder.id})" class="delete-btn">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            </div>
        `;
        list.appendChild(reminderElement);
    });
}

// Function to toggle custom reminder
function toggleCustomReminder(id, active) {
    const reminder = customReminders.find(r => r.id === id);
    if (reminder) {
        reminder.active = active;
        saveCustomReminders();
    }
}

// Function to delete custom reminder
function deleteCustomReminder(id) {
    customReminders = customReminders.filter(r => r.id !== id);
    saveCustomReminders();
    updateCustomRemindersList();
}

// Function to save custom reminders
function saveCustomReminders() {
    localStorage.setItem('customReminders', JSON.stringify(customReminders));
}

// Function to load custom reminders
function loadCustomReminders() {
    const saved = localStorage.getItem('customReminders');
    if (saved) {
        customReminders = JSON.parse(saved);
        customReminders.forEach(reminder => {
            if (reminder.active) {
                scheduleCustomReminder(reminder);
            }
        });
        updateCustomRemindersList();
    }
}

// Function to clear custom reminder form
function clearCustomReminderForm() {
    document.getElementById('reminderTitle').value = '';
    document.getElementById('reminderMessage').value = '';
    document.getElementById('reminderTime').value = '';
    document.getElementById('reminderType').value = 'info';
}

// Function to create preset reminder
function createPresetReminder(type) {
    const preset = PRESET_REMINDERS[type];
    const reminder = {
        id: Date.now(),
        title: preset.title,
        message: preset.message,
        type: preset.type,
        time: preset.defaultTime,
        icon: preset.icon,
        active: true
    };

    customReminders.push(reminder);
    scheduleCustomReminder(reminder);
    saveCustomReminders();
    updateCustomRemindersList();

    triggerNotification(
        "Reminder Created",
        `${preset.title} reminder set for ${preset.defaultTime}`,
        "info"
    );
}

// Add edit functionality
function editReminder(id) {
    const reminder = customReminders.find(r => r.id === id);
    if (!reminder) return;

    // Convert current time to 12-hour format for display
    const [hours24, minutes] = reminder.time.split(':');
    let hours12 = parseInt(hours24);
    const currentPeriod = hours12 >= 12 ? 'PM' : 'AM';
    
    if (hours12 > 12) {
        hours12 -= 12;
    } else if (hours12 === 0) {
        hours12 = 12;
    }

    const currentTime12 = `${hours12}:${minutes}`;

    // Show edit dialog with current time
    const newTime = prompt('Enter new time (HH:MM):', currentTime12);
    const newPeriod = prompt('Enter AM or PM:', currentPeriod);

    if (newTime && newPeriod && 
        /^(0?[1-9]|1[0-2]):[0-5][0-9]$/.test(newTime) && 
        /^(AM|PM)$/i.test(newPeriod)) {
        
        // Convert back to 24-hour format
        const [newHours12, newMinutes] = newTime.split(':');
        let newHours24 = parseInt(newHours12);
        
        if (newPeriod.toUpperCase() === 'PM' && newHours24 !== 12) {
            newHours24 += 12;
        } else if (newPeriod.toUpperCase() === 'AM' && newHours24 === 12) {
            newHours24 = 0;
        }

        reminder.time = `${newHours24.toString().padStart(2, '0')}:${newMinutes}`;
        saveCustomReminders();
        updateCustomRemindersList();
        scheduleCustomReminder(reminder);
        
        triggerNotification(
            "Reminder Updated",
            `${reminder.title} reminder updated to ${newTime} ${newPeriod}`,
            "info"
        );
    }
}

// Add these functions for the add reminder dialog
function showAddReminderDialog() {
    document.getElementById('addReminderDialog').style.display = 'flex';
}

function hideAddReminderDialog() {
    document.getElementById('addReminderDialog').style.display = 'none';
    // Clear form
    document.getElementById('newReminderTitle').value = '';
    document.getElementById('newReminderTime').value = '';
    document.getElementById('newReminderIcon').value = 'notifications';
}

function addNewReminder() {
    const title = document.getElementById('newReminderTitle').value;
    const timeInput = document.getElementById('newReminderTime').value;
    const period = document.getElementById('newReminderPeriod').value;
    const icon = document.getElementById('newReminderIcon').value;

    if (!title || !timeInput) {
        triggerNotification(
            "Error",
            "Please fill in all fields",
            "error"
        );
        return;
    }

    // Convert time to 24-hour format
    const [hours, minutes] = timeInput.split(':');
    let hour24 = parseInt(hours);
    
    if (period === 'PM' && hour24 !== 12) {
        hour24 += 12;
    } else if (period === 'AM' && hour24 === 12) {
        hour24 = 0;
    }

    const time24 = `${hour24.toString().padStart(2, '0')}:${minutes}`;

    const reminder = {
        id: Date.now(),
        title: title,
        message: `Time for: ${title}`,
        type: 'info',
        time: time24,
        displayTime: `${timeInput} ${period}`,
        icon: icon,
        active: true
    };

    customReminders.push(reminder);
    scheduleCustomReminder(reminder);
    saveCustomReminders();
    updateCustomRemindersList();
    hideAddReminderDialog();

    triggerNotification(
        "Reminder Created",
        `${title} reminder set for ${timeInput} ${period}`,
        "info"
    );
}

// Add click outside to close
document.addEventListener('click', (event) => {
    const dialog = document.getElementById('addReminderDialog');
    const dialogContent = dialog.querySelector('.dialog-content');
    if (event.target === dialog) {
        hideAddReminderDialog();
    }
});

// Add this function to test the water detection specifically
async function testWaterDetection() {
    try {
        debugLog("Testing water detection...");
        const model = MODELS.waterSound;
        if (!model.recognizer) {
            await initializeModel('waterSound');
        }
        await startModelListening('waterSound');
        debugLog("Water detection test started");
    } catch (error) {
        debugLog(`Water detection test error: ${error.message}`);
    }
}

// Add this test function
async function testNotification() {
    try {
        // First request permission
        if (Notification.permission !== "granted") {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
                alert("Please enable notifications to test this feature");
                return;
            }
        }

        // Try to send a test notification
        const notification = new Notification("Test Notification", {
            body: "This is a test notification",
            icon: "/icons/notification-icon.png",
            tag: "test-notification",
            requireInteraction: true,
            vibrate: [200, 100, 200]
        });

        debugLog("Test notification sent");
        
        // Log notification status
        notification.addEventListener('show', () => debugLog("Notification shown"));
        notification.addEventListener('error', (e) => debugLog("Notification error: " + e));
        notification.addEventListener('click', () => debugLog("Notification clicked"));
        notification.addEventListener('close', () => debugLog("Notification closed"));

    } catch (error) {
        debugLog("Error sending test notification: " + error.message);
        console.error("Notification error:", error);
        alert("Error sending notification: " + error.message);
    }
}

// Add a test notification function
function testNotification() {
    sendNotification(
        "Test Notification",
        "This is a test notification. If you see this, notifications are working!"
    );
}
 