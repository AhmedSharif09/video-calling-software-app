/* ======================================================
   Adeeb Meet — WebRTC Engine with PeerJS
   How it works:
   1. Host creates meeting → gets a unique room ID in URL
   2. Anyone who opens the same URL joins that room
   3. Each peer connects to every other peer via WebRTC
   ====================================================== */

// ===== NAVIGATION SYSTEM =====
let currentPage = 'landing';
let myName = 'You';

function toggleMobileNav() {
    const links = document.getElementById('nav-links');
    const btn = document.getElementById('hamburger-btn');
    links.classList.toggle('mobile-open');
    btn.classList.toggle('open');
}

// Close mobile nav when a link is clicked
document.addEventListener('click', (e) => {
    const links = document.getElementById('nav-links');
    const btn = document.getElementById('hamburger-btn');
    if (links && btn && !links.contains(e.target) && !btn.contains(e.target)) {
        links.classList.remove('mobile-open');
        btn.classList.remove('open');
    }
});

function navigate(page) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const navEl = document.getElementById('nav-' + (page === 'landing' ? 'home' : page));
    if (navEl) navEl.classList.add('active');

    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const target = document.getElementById(page);
    if (target) {
        target.classList.remove('hidden');
        currentPage = page;
    }
    window.scrollTo(0, 0);

    // Hide footer in meeting room and dashboard
    const footer = document.querySelector('.site-footer');
    if (footer) footer.style.display = (page === 'meeting-room' || page === 'dashboard') ? 'none' : '';
    const navbar = document.getElementById('navbar');
    if (navbar) navbar.style.display = page === 'meeting-room' ? 'none' : '';
}

function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const target = document.getElementById(page);
    if (target) target.classList.remove('hidden');
    const footer = document.querySelector('.site-footer');
    if (footer) footer.style.display = '';
}

function setActive(el) {
    document.querySelectorAll('.sidebar-link').forEach(a => a.classList.remove('active'));
    el.classList.add('active');
}

function performLogin() {
    navigate('dashboard');
}

function performSignup() {
    navigate('dashboard');
}

// ===== TOAST =====
let _toastTimer = null;
function showToast(msg, icon = 'fa-check-circle') {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${msg}`;
    toast.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        _toastTimer = null;
    }, 3000);
}

// ===== ROOM ID UTILITIES =====
function generateRoomId() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

// Helper to scrub manual input text consistently
function cleanRoomId(inputStr) {
    return inputStr.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getRoomIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || null;
}

function setRoomInUrl(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.pushState({}, '', url.toString());
}

function getRoomLink(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    return url.toString();
}

// ===== CREATE / JOIN FROM LANDING =====
function createMeeting() {
    const name = prompt('Enter your name:', 'Muhammad') || 'Muhammad';
    myName = name.trim() || 'User';
    const roomId = generateRoomId();
    setRoomInUrl(roomId);
    startMeetingRoom(roomId);
}

function joinByCode() {
    const input = document.getElementById('join-code-input');
    const code = input ? input.value.trim() : '';
    if (!code) { showToast('Please enter a room code', 'fa-exclamation-circle'); return; }
    const name = prompt('Enter your name:', 'Guest') || 'Guest';
    myName = name.trim() || 'Guest';
    const roomId = cleanRoomId(code);
    setRoomInUrl(roomId);
    startMeetingRoom(roomId);
}

function copyRoomLink() {
    const input = document.getElementById('join-code-input');
    const rawCode = input ? input.value.trim() : '';
    // Use user-provided code if present; otherwise, fallback to creating a random code
    const roomId = rawCode ? cleanRoomId(rawCode) : generateRoomId();
    const link = getRoomLink(roomId);
    
    navigator.clipboard.writeText(link).then(() => {
        showToast('Room link copied to clipboard!');
    }).catch(() => {
        prompt('Copy this link:', link);
    });
}

// ===== WEBRTC ENGINE =====
let localStream = null;
let peer = null;
let roomId = null;
let timerInterval = null;
let seconds = 0;

let micOn = true;
let camOn = true;
let screenSharing = false;
let screenStream = null;
let handRaised = false;

// Track all active peer connections and their streams
const connections = {};  // peerId -> MediaConnection
const peerStreams = {};  // peerId -> MediaStream
const peerNames = {};    // peerId -> name

let myPeerId = null;
let isRoomHost = false;
let hostConn = null; // DataConnection to host (if not host)
const dataConns = {}; // peerId -> DataConnection (for signaling/chat)

async function startMeetingRoom(rid) {
    roomId = rid;
    navigate('meeting-room');

    document.getElementById('room-title').textContent = 'Room: ' + rid;
    document.getElementById('room-id-display').textContent = rid;

    setConnStatus('Accessing camera...');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
        console.warn('Camera/mic denied, using silent stream', e);
        localStream = await createSilentStream();
    }

    addVideoTile('local', localStream, myName + ' (You)', true);
    updateGridLayout();
    updateParticipantsCount();
    startRoomTimer();
    setConnStatus('Connecting to room...');
    initPeer(rid);
}

function createSilentStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, 640, 480);
    const videoStream = canvas.captureStream(15);
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    const silentTrack = dest.stream.getAudioTracks()[0];
    videoStream.addTrack(silentTrack);
    return Promise.resolve(videoStream);
}

function initPeer(rid) {
    const hostId = 'vividcall-' + rid;

    peer = new Peer(hostId, {
        debug: 0,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });

    peer.on('open', (id) => {
        myPeerId = id;
        isRoomHost = true;
        setConnStatus('You are the host. Share the link to invite others!', true);
        setupHostListeners();
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            // Host peer already taken! Gracefully destroy it to avoid socket event collision loops before guest shift
            peer.destroy();
            joinAsGuest(rid, hostId);
        } else {
            console.error('Peer error:', err);
            setConnStatus('Connection error: ' + err.message);
        }
    });
}

function setupHostListeners() {
    // Host receives incoming calls from joining guests
    peer.on('call', (call) => {
        call.answer(localStream);
        handleIncomingCall(call);
    });

    // Host receives data connections for signaling
    peer.on('connection', (conn) => {
        handleDataConnection(conn, true);
    });
}

function joinAsGuest(rid, hostId) {
    const guestId = 'vividcall-' + rid + '-' + generateRoomId();
    peer = new Peer(guestId, {
        debug: 0,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', (id) => {
        myPeerId = id;
        isRoomHost = false;
        setConnStatus('Joining room...');

        // Connect to host via data channel first (send our name + id)
        const dc = peer.connect(hostId, { reliable: true, metadata: { name: myName } });
        dc.on('open', () => {
            dataConns[hostId] = dc;
            dc.send(JSON.stringify({ type: 'hello', name: myName, id: myPeerId }));
        });
        handleDataConnection(dc, false, hostId);

        // Call the host with our media
        setTimeout(() => {
            const call = peer.call(hostId, localStream, { metadata: { name: myName } });
            handleIncomingCall(call);
        }, 500);

        // Listen for calls from other peers the host tells us about
        peer.on('call', (call) => {
            call.answer(localStream);
            handleIncomingCall(call);
        });
        peer.on('connection', (conn) => {
            handleDataConnection(conn, false);
        });
    });

    peer.on('error', (err) => {
        setConnStatus('Error joining: ' + err.message);
    });
}

function handleIncomingCall(call) {
    const remotePeerId = call.peer;
    const peerName = call.metadata?.name || 'Guest';
    peerNames[remotePeerId] = peerName;

    call.on('stream', (remoteStream) => {
        peerStreams[remotePeerId] = remoteStream;
        connections[remotePeerId] = call;

        // Add or update video tile
        const existing = document.getElementById('tile-' + remotePeerId);
        if (!existing) {
            addVideoTile(remotePeerId, remoteStream, peerName, false);
            updateGridLayout();
        } else {
            const video = existing.querySelector('video');
            if (video) video.srcObject = remoteStream;
        }

        setConnStatus('Connected! ' + (Object.keys(peerStreams).length + 1) + ' people in room', true);
    });

    call.on('close', () => {
        removePeerTile(remotePeerId);
    });

    call.on('error', (err) => {
        console.warn('Call error:', err);
        removePeerTile(remotePeerId);
    });
}

function handleDataConnection(conn, asHost, fromId) {
    const dcPeerId = fromId || conn.peer;

    conn.on('open', () => {
        dataConns[dcPeerId] = conn;
        if (asHost) {
            // Host sends list of current room participants to newly arriving peer
            conn.send(JSON.stringify({ type: 'welcome', peers: getPeerList() }));
            
            // Broadcast alert to older existing room peers so they call this new client
            const joinAlert = JSON.stringify({ 
                type: 'peer-joined', 
                id: conn.peer, 
                name: conn.metadata?.name || 'Guest' 
            });
            Object.entries(dataConns).forEach(([pid, dChannel]) => {
                if (pid !== conn.peer && dChannel.open) {
                    dChannel.send(joinAlert);
                }
            });
        }
    });

    conn.on('data', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'hello') {
            peerNames[msg.id] = msg.name;
            conn.send(JSON.stringify({ type: 'welcome', peers: getPeerList() }));
            
            // Host broadcasts to older participants about this new handshake addition
            if (asHost) {
                const joinAlert = JSON.stringify({ type: 'peer-joined', id: msg.id, name: msg.name });
                Object.entries(dataConns).forEach(([pid, dChannel]) => {
                    if (pid !== msg.id && dChannel.open) {
                        dChannel.send(joinAlert);
                    }
                });
            }
        } else if (msg.type === 'welcome' && !isRoomHost) {
            // Connect to all existing peers in room
            msg.peers.forEach(p => {
                if (p.id !== myPeerId && !connections[p.id]) {
                    connectToPeer(p.id, p.name);
                }
            });
        } else if (msg.type === 'chat') {
            displayChatMsg(msg.name, msg.text, false);
            // Host forwards chat to all other peers
            if (isRoomHost) {
                const fwd = JSON.stringify(msg);
                Object.entries(dataConns).forEach(([pid, dChannel]) => {
                    if (pid !== dcPeerId && dChannel.open) { try { dChannel.send(fwd); } catch(e){} }
                });
            }
        } else if (msg.type === 'hand-raise') {
            updateHandIndicator(msg.id, msg.raised);
            if (msg.raised) showToast(escapeHtml(msg.name) + ' raised their hand ✋', 'fa-hand');
            // Host forwards to all other peers
            if (isRoomHost) {
                const fwd = JSON.stringify(msg);
                Object.entries(dataConns).forEach(([pid, dChannel]) => {
                    if (pid !== dcPeerId && dChannel.open) { try { dChannel.send(fwd); } catch(e){} }
                });
            }
        } else if (msg.type === 'peer-joined') {
            if (msg.id !== myPeerId && !connections[msg.id]) {
                connectToPeer(msg.id, msg.name);
            }
        } else if (msg.type === 'peer-left') {
            removePeerTile(msg.id);
        }
    });

    conn.on('close', () => {
        delete dataConns[dcPeerId];
        removePeerTile(dcPeerId);
    });
}

function connectToPeer(targetId, targetName) {
    if (connections[targetId] || targetId === myPeerId) return;
    peerNames[targetId] = targetName || 'Guest';

    const call = peer.call(targetId, localStream, { metadata: { name: myName } });
    handleIncomingCall(call);

    const dc = peer.connect(targetId, { reliable: true });
    dc.on('open', () => { dataConns[targetId] = dc; });
    handleDataConnection(dc, false, targetId);
}

function getPeerList() {
    const list = [{ id: myPeerId, name: myName }];
    Object.keys(connections).forEach(pid => {
        list.push({ id: pid, name: peerNames[pid] || 'Guest' });
    });
    return list;
}

// ===== VIDEO TILES =====
const AVATAR_COLORS = [
    'linear-gradient(135deg,#6366f1,#8b5cf6)',
    'linear-gradient(135deg,#0ea5e9,#06b6d4)',
    'linear-gradient(135deg,#f43f5e,#ec4899)',
    'linear-gradient(135deg,#10b981,#059669)',
    'linear-gradient(135deg,#f59e0b,#d97706)',
    'linear-gradient(135deg,#8b5cf6,#ec4899)',
    'linear-gradient(135deg,#14b8a6,#0891b2)',
    'linear-gradient(135deg,#f97316,#ef4444)',
];
let colorIndex = 0;

// Speaker detection via AudioContext (real-time volume monitoring)
const audioAnalysers = {}; // peerId -> { analyser, interval }
let speakerMuted = false;

function startAudioMonitor(peerId, stream) {
    try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let silentFrames = 0;

        const interval = setInterval(() => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                sum += Math.abs(data[i] - 128);
            }
            const avg = sum / data.length;
            const tile = document.getElementById('tile-' + peerId);
            if (!tile) { clearInterval(interval); return; }
            if (avg > 4) {
                silentFrames = 0;
                tile.classList.add('speaking');
                updateSpeakBars(peerId, true);
            } else {
                silentFrames++;
                if (silentFrames > 6) {
                    tile.classList.remove('speaking');
                    updateSpeakBars(peerId, false);
                }
            }
        }, 80);
        audioAnalysers[peerId] = { ctx, interval };
    } catch(e) {
        console.warn('Audio monitor failed:', e);
    }
}

function stopAudioMonitor(peerId) {
    if (audioAnalysers[peerId]) {
        clearInterval(audioAnalysers[peerId].interval);
        try { audioAnalysers[peerId].ctx.close(); } catch(e){}
        delete audioAnalysers[peerId];
    }
}

function updateSpeakBars(peerId, active) {
    const tile = document.getElementById('tile-' + peerId);
    if (!tile) return;
    const bars = tile.querySelector('.speak-bars');
    if (bars) bars.style.opacity = active ? '1' : '0';
}

function addVideoTile(id, stream, name, isLocal) {
    const grid = document.getElementById('video-grid');
    if (document.getElementById('tile-' + id)) return;

    const tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'tile-' + id;

    const color = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
    colorIndex++;
    const initials = getInitials(name);

    const hasVideo = stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;

    tile.innerHTML = `
        <video autoplay ${isLocal ? 'muted' : ''} playsinline style="display:${hasVideo ? 'block' : 'none'}"></video>

        <div class="tile-no-cam" style="display:${hasVideo ? 'none' : 'flex'}">
            <div class="tile-avatar" style="background:${color}">${initials}</div>
            <div class="tile-avatar-name">${escapeHtml(name)}</div>
        </div>

        <div class="tile-footer">
            <div class="tile-footer-left">
                <div class="speak-bars" style="opacity:0">
                    <span></span><span></span><span></span><span></span>
                </div>
                <span class="tile-name-text">${escapeHtml(name)}${isLocal ? ' <em class="you-tag">You</em>' : ''}</span>
            </div>
            <div class="tile-footer-right">
                <span class="tile-badge tile-muted-badge hidden" title="Muted"><i class="fa-solid fa-microphone-slash"></i></span>
                <span class="tile-badge tile-novid-badge hidden" title="Camera off"><i class="fa-solid fa-video-slash"></i></span>
            </div>
        </div>
    `;

    const video = tile.querySelector('video');
    if (stream) video.srcObject = stream;

    // Show novid badge if camera off
    if (!hasVideo) tile.querySelector('.tile-novid-badge').classList.remove('hidden');

    grid.appendChild(tile);
    updateGridLayout();
    updateParticipantsCount();

    // Start audio monitor for remotes
    if (!isLocal && stream) {
        startAudioMonitor(id, stream);
    }

    // Show join notification
    if (!isLocal) {
        showJoinNotification(name + ' joined the meeting');
        showToast(name + ' joined', 'fa-user-plus');
    }
}

function removePeerTile(peerId) {
    stopAudioMonitor(peerId);
    const tile = document.getElementById('tile-' + peerId);
    if (tile) {
        tile.style.animation = 'tileLeave 0.3s ease forwards';
        setTimeout(() => tile.remove(), 300);
    }
    delete peerStreams[peerId];
    delete connections[peerId];
    delete peerNames[peerId];
    updateGridLayout();
    updateParticipantsCount();
}

function updateGridLayout() {
    const grid = document.getElementById('video-grid');
    const count = grid.querySelectorAll('.video-tile').length;
    grid.className = 'video-grid count-' + Math.min(count, 9);
}

// ===== CONTROLS =====
function toggleMic() {
    micOn = !micOn;
    if (localStream) {
        localStream.getAudioTracks().forEach(t => t.enabled = micOn);
    }
    const btn = document.getElementById('mic-btn');
    const icon = btn.querySelector('i');
    icon.className = micOn ? 'fa-solid fa-microphone' : 'fa-solid fa-microphone-slash';
    btn.className = 'ctrl-btn ' + (micOn ? 'active' : 'off');
    btn.querySelector('span').textContent = micOn ? 'Mute' : 'Unmute';

    // Update local tile muted badge
    const localTile = document.getElementById('tile-local');
    if (localTile) {
        const badge = localTile.querySelector('.tile-muted-badge');
        if (badge) badge.classList.toggle('hidden', micOn);
    }
}

function toggleCam() {
    camOn = !camOn;
    if (localStream) {
        localStream.getVideoTracks().forEach(t => t.enabled = camOn);
    }
    const btn = document.getElementById('cam-btn');
    const icon = btn.querySelector('i');
    icon.className = camOn ? 'fa-solid fa-video' : 'fa-solid fa-video-slash';
    btn.className = 'ctrl-btn ' + (camOn ? 'active' : 'off');
    btn.querySelector('span').textContent = camOn ? 'Stop Video' : 'Start Video';

    const localTile = document.getElementById('tile-local');
    if (localTile) {
        const vid = localTile.querySelector('video');
        const noCam = localTile.querySelector('.tile-no-cam');
        const novid = localTile.querySelector('.tile-novid-badge');
        if (vid) vid.style.display = camOn ? 'block' : 'none';
        if (noCam) noCam.style.display = camOn ? 'none' : 'flex';
        if (novid) novid.classList.toggle('hidden', camOn);
    }
}

async function toggleScreen() {
    const btn = document.getElementById('screen-btn');
    if (!screenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            screenSharing = true;
            btn.classList.add('active');
            btn.querySelector('span').textContent = 'Stop Share';

            const screenTrack = screenStream.getVideoTracks()[0];
            Object.values(connections).forEach(call => {
                if (call.peerConnection) {
                    const sender = call.peerConnection.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                }
            });

            const localVideo = document.querySelector('#tile-local video');
            if (localVideo) { localVideo.srcObject = screenStream; localVideo.style.display = 'block'; }
            const noCam = document.querySelector('#tile-local .tile-no-cam');
            if (noCam) noCam.style.display = 'none';

            screenTrack.onended = () => stopScreenShare();
        } catch (e) {
            showToast('Screen sharing cancelled', 'fa-exclamation-circle');
        }
    } else {
        stopScreenShare();
    }
}

function stopScreenShare() {
    screenSharing = false;
    const btn = document.getElementById('screen-btn');
    btn.classList.remove('active');
    btn.querySelector('span').textContent = 'Share Screen';

    if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }

    if (localStream) {
        const camTrack = localStream.getVideoTracks()[0];
        if (camTrack) {
            Object.values(connections).forEach(call => {
                if (call.peerConnection) {
                    const sender = call.peerConnection.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) sender.replaceTrack(camTrack);
                }
            });
        }
        const localVideo = document.querySelector('#tile-local video');
        if (localVideo) localVideo.srcObject = localStream;
    }
}

function toggleSpeaker() {
    speakerMuted = !speakerMuted;
    const btn = document.getElementById('speaker-btn');
    const icon = btn.querySelector('i');
    icon.className = speakerMuted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
    btn.className = 'ctrl-btn ' + (speakerMuted ? 'off' : 'active');
    btn.querySelector('span').textContent = speakerMuted ? 'Speaker Off' : 'Speaker';

    // Mute/unmute all remote video elements
    document.querySelectorAll('.video-tile:not(#tile-local) video').forEach(v => {
        v.muted = speakerMuted;
    });
    showToast(speakerMuted ? 'Speaker muted' : 'Speaker on', speakerMuted ? 'fa-volume-xmark' : 'fa-volume-high');
}

function toggleChat() {
    const panel = document.getElementById('chat-panel');
    const pPanel = document.getElementById('participants-panel');
    if (pPanel) pPanel.classList.add('hidden');
    document.getElementById('participants-btn').classList.remove('active');

    panel.classList.toggle('hidden');
    const btn = document.getElementById('chat-btn');
    const isOpen = !panel.classList.contains('hidden');
    btn.classList.toggle('active', isOpen);

    // Clear unread badge when opened
    if (isOpen) {
        const badge = document.getElementById('chat-unread-badge');
        if (badge) { badge.classList.add('hidden'); badge.textContent = ''; }
        unreadCount = 0;
        // Scroll to bottom
        const msgs = document.getElementById('chat-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }
}

let unreadCount = 0;
let lastChatSender = '';

function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    displayChatMsg(myName, text, true);

    const msg = JSON.stringify({ type: 'chat', name: myName, text });
    Object.values(dataConns).forEach(dc => {
        try { if (dc.open) dc.send(msg); } catch (e) {}
    });
}

function displayChatMsg(name, text, isMe) {
    const container = document.getElementById('chat-messages');
    const panel = document.getElementById('chat-panel');

    // Group messages by same sender
    const isSameSender = lastChatSender === name;
    lastChatSender = name;

    const div = document.createElement('div');
    div.className = 'chat-msg-wrap' + (isMe ? ' me' : '');

    const initials = getInitials(name);
    const color = getAvatarColorForName(name);

    div.innerHTML = `
        ${!isSameSender ? `
        <div class="chat-msg-header">
            <div class="chat-avatar" style="background:${color}">${initials}</div>
            <div class="chat-sender-info">
                <span class="chat-sender-name">${isMe ? 'You' : escapeHtml(name)}</span>
                <span class="chat-msg-time">${getTimeNow()}</span>
            </div>
        </div>` : ''}
        <div class="chat-msg-body ${isMe ? 'me' : ''}">
            ${isSameSender && !isMe ? '<div style="width:32px;flex-shrink:0"></div>' : ''}
            <div class="msg-bubble ${isMe ? 'me' : ''}">${escapeHtml(text)}</div>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // Unread badge when chat is closed
    if (panel.classList.contains('hidden') && !isMe) {
        unreadCount++;
        const badge = document.getElementById('chat-unread-badge');
        if (badge) {
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            badge.classList.remove('hidden');
        }
        showToast(name + ': ' + text.slice(0, 40), 'fa-comment-dots');
    }
}

function getAvatarColorForName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function getTimeNow() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function endMeeting() {
    if (!confirm('Leave this meeting?')) return;
    const msg = JSON.stringify({ type: 'peer-left', id: myPeerId });
    Object.values(dataConns).forEach(dc => { try { if (dc.open) dc.send(msg); } catch (e) {} });
    cleanupMeeting();
}

function cleanupMeeting() {
    // Stop all audio monitors
    Object.keys(audioAnalysers).forEach(stopAudioMonitor);

    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    if (peer) peer.destroy();
    if (timerInterval) clearInterval(timerInterval);
    if (clockInterval) clearInterval(clockInterval);

    localStream = null; screenStream = null; peer = null; timerInterval = null;
    seconds = 0; micOn = true; camOn = true; screenSharing = false; handRaised = false;
    unreadCount = 0; lastChatSender = ''; colorIndex = 0; speakerMuted = false;

    Object.keys(connections).forEach(k => delete connections[k]);
    Object.keys(peerStreams).forEach(k => delete peerStreams[k]);
    Object.keys(dataConns).forEach(k => delete dataConns[k]);
    Object.keys(peerNames).forEach(k => delete peerNames[k]);

    document.getElementById('video-grid').innerHTML = '';
    document.getElementById('chat-messages').innerHTML = '';

    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.pushState({}, '', url.toString());
    navigate('dashboard');
}

// ===== PARTICIPANTS PANEL =====
function toggleParticipants() {
    const panel = document.getElementById('participants-panel');
    const chatPanel = document.getElementById('chat-panel');
    chatPanel.classList.add('hidden');
    document.getElementById('chat-btn').classList.remove('active');

    panel.classList.toggle('hidden');
    const btn = document.getElementById('participants-btn');
    btn.classList.toggle('active', !panel.classList.contains('hidden'));
    if (!panel.classList.contains('hidden')) updateParticipantsList();
}

function updateParticipantsCount() {
    const total = 1 + Object.keys(connections).length;
    const badge = document.getElementById('participants-count');
    const panelCount = document.getElementById('participants-count-panel');
    if (badge) badge.textContent = total;
    if (panelCount) panelCount.textContent = total;
    const panel = document.getElementById('participants-panel');
    if (panel && !panel.classList.contains('hidden')) updateParticipantsList();
}

function updateParticipantsList() {
    const list = document.getElementById('participants-list');
    if (!list) return;
    list.innerHTML = '';

    const allPeers = [
        { id: 'local', name: myName, isSelf: true, handRaised: handRaised, micOn: micOn, camOn: camOn }
    ];
    Object.keys(peerNames).forEach(pid => {
        const tile = document.getElementById('tile-' + pid);
        const tileHandRaised = tile && tile.querySelector('.hand-indicator');
        allPeers.push({ id: pid, name: peerNames[pid] || 'Guest', isSelf: false, handRaised: !!tileHandRaised });
    });

    allPeers.forEach(p => {
        const color = getAvatarColorForName(p.name);
        const initials = getInitials(p.name);
        const tile = document.getElementById('tile-' + p.id);
        const isSpeaking = tile && tile.classList.contains('speaking');

        const item = document.createElement('div');
        item.className = 'participant-item' + (isSpeaking ? ' is-speaking' : '');
        item.id = 'plist-' + p.id;
        item.innerHTML = `
            <div class="participant-avatar-wrap">
                <div class="participant-avatar" style="background:${color}">${initials}</div>
                ${isSpeaking ? '<div class="participant-speak-ring"></div>' : ''}
            </div>
            <div class="participant-info">
                <span class="participant-name">${escapeHtml(p.name)}${p.isSelf ? ' <em class="you-tag">You</em>' : ''}</span>
                ${isSpeaking ? '<span class="participant-status speaking-status"><i class="fa-solid fa-microphone"></i> Speaking</span>' : ''}
                ${p.handRaised && !isSpeaking ? '<span class="participant-status hand-status">✋ Hand raised</span>' : ''}
            </div>
            <div class="participant-icons">
                ${p.isSelf && !micOn ? '<i class="fa-solid fa-microphone-slash" title="Muted"></i>' : ''}
                ${p.isSelf && !camOn ? '<i class="fa-solid fa-video-slash" title="Camera off"></i>' : ''}
                ${p.handRaised ? '<i class="fa-solid fa-hand" style="color:#f59e0b"></i>' : ''}
            </div>
        `;
        list.appendChild(item);
    });
}

// ===== HAND RAISE =====
function raiseHand() {
    handRaised = !handRaised;
    const btn = document.getElementById('hand-btn');
    btn.classList.toggle('active', handRaised);
    btn.classList.toggle('hand-raised', handRaised);
    btn.querySelector('span').textContent = handRaised ? 'Lower Hand' : 'Raise Hand';
    btn.querySelector('i').style.color = handRaised ? '#f59e0b' : '';

    updateHandIndicator('local', handRaised);

    const msg = JSON.stringify({ type: 'hand-raise', id: myPeerId, name: myName, raised: handRaised });
    Object.values(dataConns).forEach(dc => { try { if (dc.open) dc.send(msg); } catch(e){} });

    if (handRaised) showToast('You raised your hand ✋', 'fa-hand');
    updateParticipantsCount();
}

function updateHandIndicator(tileId, raised) {
    const tile = document.getElementById('tile-' + tileId);
    if (!tile) return;
    let indicator = tile.querySelector('.hand-indicator');
    if (raised) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'hand-indicator';
            indicator.innerHTML = '✋';
            tile.appendChild(indicator);
        }
    } else {
        if (indicator) indicator.remove();
    }
    updateParticipantsList();
}

// ===== JOIN NOTIFICATION =====
function showJoinNotification(msg) {
    const el = document.getElementById('join-notification');
    if (!el) return;
    el.innerHTML = `<i class="fa-solid fa-user-plus"></i> ${escapeHtml(msg)}`;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ===== ROOM TIMER =====
let clockInterval = null;

function startRoomTimer() {
    seconds = 0;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        const el = document.getElementById('room-timer-badge');
        if (el) el.textContent = m + ':' + s;
    }, 1000);

    // Bottom bar clock
    if (clockInterval) clearInterval(clockInterval);
    const updateClock = () => {
        const el = document.getElementById('ctrl-clock');
        if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    updateClock();
    clockInterval = setInterval(updateClock, 10000);
}


// ===== DEVICE SETTINGS =====
async function openDeviceSettings() {
    const modal = document.getElementById('device-settings-modal');
    modal.classList.remove('hidden');

    try {
        // Request permission first so labels are available
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => {});
        const devices = await navigator.mediaDevices.enumerateDevices();
        const micSelect = document.getElementById('mic-select');
        const camSelect = document.getElementById('cam-select');
        micSelect.innerHTML = '';
        camSelect.innerHTML = '';

        let micCount = 1, camCount = 1;
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            if (device.kind === 'audioinput') {
                option.textContent = device.label || 'Microphone ' + micCount++;
                // Mark current
                if (localStream) {
                    const curTrack = localStream.getAudioTracks()[0];
                    if (curTrack && curTrack.getSettings().deviceId === device.deviceId) option.selected = true;
                }
                micSelect.appendChild(option);
            } else if (device.kind === 'videoinput') {
                option.textContent = device.label || 'Camera ' + camCount++;
                if (localStream) {
                    const curTrack = localStream.getVideoTracks()[0];
                    if (curTrack && curTrack.getSettings().deviceId === device.deviceId) option.selected = true;
                }
                camSelect.appendChild(option);
            }
        });

        if (!micSelect.options.length) micSelect.innerHTML = '<option value="">No microphone found</option>';
        if (!camSelect.options.length) camSelect.innerHTML = '<option value="">No camera found</option>';
    } catch (e) {
        showToast('Could not list devices', 'fa-exclamation-circle');
    }
}

function closeDeviceSettings() {
    document.getElementById('device-settings-modal').classList.add('hidden');
}

async function applyDeviceSettings() {
    const micId = document.getElementById('mic-select').value;
    const camId = document.getElementById('cam-select').value;

    try {
        const constraints = {
            audio: micId ? { deviceId: { exact: micId } } : true,
            video: camId ? { deviceId: { exact: camId } } : true
        };
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Stop old local tracks
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        localStream = newStream;

        // Restore mute/cam states
        localStream.getAudioTracks().forEach(t => t.enabled = micOn);
        localStream.getVideoTracks().forEach(t => t.enabled = camOn);

        // Update local video tile
        const localVideo = document.querySelector('#tile-local video');
        if (localVideo) {
            localVideo.srcObject = newStream;
            localVideo.style.display = camOn ? 'block' : 'none';
            const noCam = document.querySelector('#tile-local .no-cam');
            if (noCam) noCam.style.display = camOn ? 'none' : 'flex';
        }

        // Replace tracks in all active peer connections
        Object.values(connections).forEach(call => {
            if (call.peerConnection) {
                const senders = call.peerConnection.getSenders();
                newStream.getTracks().forEach(track => {
                    const sender = senders.find(s => s.track && s.track.kind === track.kind);
                    if (sender) sender.replaceTrack(track).catch(e => console.warn('replaceTrack error:', e));
                });
            }
        });

        showToast('Devices switched successfully!', 'fa-check-circle');
        closeDeviceSettings();
    } catch (e) {
        showToast('Could not switch device: ' + e.message, 'fa-exclamation-circle');
    }
}

// ===== TIMER (kept but not called — meetings are unlimited) =====
function startTimer() {
    seconds = 0;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        document.getElementById('timer').textContent = m + ':' + s;
    }, 1000);
}

// ===== CONNECTION STATUS =====
function setConnStatus(msg, hide = false) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.innerHTML = hide 
        ? `<i class="fa-solid fa-circle-check" style="color:var(--green)"></i> ${msg}`
        : `<i class="fa-solid fa-circle-notch fa-spin"></i> ${msg}`;
    el.classList.remove('hidden');
    if (hide) {
        setTimeout(() => el.classList.add('hidden'), 4000);
    }
}

// ===== COPY CURRENT ROOM LINK =====
function copyCurrentRoomLink() {
    const link = getRoomLink(roomId);
    navigator.clipboard.writeText(link).then(() => {
        showToast('Meeting link copied! Share it to invite others');
    }).catch(() => {
        prompt('Copy this link to invite others:', link);
    });
}

// ===== INIT ON LOAD =====
window.addEventListener('load', () => {
    // Check if there's a room ID in the URL — auto-join
    const rid = getRoomIdFromUrl();
    if (rid) {
        const name = prompt('Enter your name to join the meeting:', 'Guest') || 'Guest';
        myName = name.trim() || 'Guest';
        startMeetingRoom(rid);
    } else {
        navigate('landing');
    }

    console.log('%cAdeeb Meet WebRTC Engine Ready 🚀', 'color:#6366f1;font-size:16px;font-weight:bold');
});