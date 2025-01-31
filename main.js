/****************************************************
 * Main JavaScript for the P2P Card Game
 ****************************************************/

// Global game state object
const gameState = {
  players: [],           // Array of player objects { id, hp, lifeforce, hand: [], ... }
  currentTurn: null,     // The peer id of the current turn
  hostId: null,          // Host peer id (if this instance is host)
  peer: null,            // PeerJS instance
  conn: null,            // Connection to host (if client)
  deck: [],              // The deck of cards (array of card objects)
  battlefield: {},       // Map slotNumber -> array of card ids
};

// Utility functions
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Card Database ---
// Will be loaded from cards.json (see file below)
let cardDatabase = [];

/* -------------- Initialization -------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Load card database then initialize game
  fetch('cards.json')
    .then(response => response.json())
    .then(data => {
      cardDatabase = data;
      // After loading cards, initialize deck slicing and game setup
      sliceDeckImage();
      initGame();
    })
    .catch(err => console.error('Error loading cards.json:', err));
});

/* -------------- Game Initialization -------------- */
function initGame() {
  // Determine whether to create host or join a game using URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const joinId = urlParams.get('joinId');
  if (joinId) {
    initPeerClient(joinId);
  } else {
    initPeerHost();
  }
  setupUIListeners();
  setupDragAndDrop();
}

/* -------------- PeerJS Setup -------------- */
// Host Setup
function initPeerHost() {
  const peer = new Peer(); // generates an id automatically
  gameState.peer = peer;
  peer.on('open', id => {
    gameState.hostId = id;
    console.log('Hosting game with Peer ID:', id);
    // For convenience, display join instructions:
    alert(`Hosting game. To join, open another browser window with "?joinId=${id}" appended to the URL.`);
    // Add host as a player:
    addPlayer(id);
    // Set current turn to host initially
    gameState.currentTurn = id;
    updateTurnIndicator();
  });
  // Listen for incoming connections:
  peer.on('connection', conn => {
    conn.on('data', data => {
      handleIncomingAction(data, conn);
    });
  });
}
// Client Setup
function initPeerClient(hostId) {
  const peer = new Peer();
  gameState.peer = peer;
  peer.on('open', id => {
    console.log('Client Peer ID:', id, 'Connecting to host:', hostId);
    const conn = peer.connect(hostId);
    gameState.conn = conn;
    conn.on('open', () => {
      // Send join message to host
      conn.send({ action: 'join', peerId: id });
    });
    conn.on('data', data => {
      handleIncomingAction(data);
    });
  });
}

/* -------------- Action Handling -------------- */
function handleIncomingAction(data, conn = null) {
  // Process incoming messages (from clients or host)
  switch(data.action) {
    case 'join':
      // Only host should process join messages
      if (gameState.hostId) {
        addPlayer(data.peerId);
        broadcastGameState();
      }
      break;
    case 'moveCard':
      // Update card position (data.details: { cardId, slot })
      updateCardSlot(data.details.cardId, data.details.slot);
      break;
    case 'flipCard':
      toggleFlipCard(data.details.cardId);
      break;
    case 'rotateCard':
      rotateCard(data.details.cardId);
      break;
    case 'endTurn':
      endTurn();
      break;
    case 'updateState':
      // For client: update local game state from host
      Object.assign(gameState, data.state);
      refreshUI();
      break;
    default:
      console.warn('Unhandled action:', data.action);
  }
  // If this instance is the host, broadcast updated state
  if (gameState.hostId && gameState.peer && gameState.peer.connections) {
    broadcastGameState();
  }
}

/* -------------- Player Management -------------- */
function addPlayer(peerId) {
  // Only add if not already present
  if (!gameState.players.find(p => p.id === peerId)) {
    const newPlayer = {
      id: peerId,
      hp: 40,
      lifeforce: 10,
      hand: []
    };
    gameState.players.push(newPlayer);
    console.log('Player added:', newPlayer);
    updateResourceDisplays();
  }
}

/* -------------- Broadcast Game State (Host Only) -------------- */
function broadcastGameState() {
  if (gameState.hostId && gameState.peer.connections) {
    Object.values(gameState.peer.connections).forEach(connArray => {
      connArray.forEach(conn => {
        conn.send({ action: 'updateState', state: gameState });
      });
    });
  }
}

/* -------------- UI Listeners -------------- */
function setupUIListeners() {
  document.getElementById('end-turn').addEventListener('click', () => {
    if (isMyTurn()) {
      sendAction({ action: 'endTurn' });
      endTurn();
    }
  });
  document.getElementById('reset-game').addEventListener('click', resetGame);
  document.getElementById('forfeit').addEventListener('click', forfeitGame);
  
  // Context menu listener
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (e.target.classList.contains('card')) {
      showContextMenu(e.pageX, e.pageY, e.target);
    }
  });
  document.addEventListener('click', hideContextMenu);
}

/* -------------- UI Update Functions -------------- */
function updateResourceDisplays() {
  // Assume the local player is the one whose id equals gameState.peer.id
  const localPlayer = gameState.players.find(p => p.id === gameState.peer.id);
  if (localPlayer) {
    document.getElementById('hp-display').textContent = `HP: ${localPlayer.hp}`;
    document.getElementById('lifeforce-display').textContent = `Lifeforce: ${localPlayer.lifeforce}`;
  }
}
function updateTurnIndicator() {
  document.getElementById('turn-indicator').textContent = `Current Turn: ${gameState.currentTurn}`;
}
function refreshUI() {
  // For a full implementation, update the battlefield, hand, and other dynamic UI parts.
  updateResourceDisplays();
  updateTurnIndicator();
}

/* -------------- Turn Management -------------- */
function isMyTurn() {
  return gameState.peer.id === gameState.currentTurn;
}
function endTurn() {
  // Regenerate lifeforce (+5, max 10) for the player whose turn is ending
  gameState.players.forEach(p => {
    p.lifeforce = clamp(p.lifeforce + 5, 0, 10);
  });
  // Rotate turn order: simply select the next player in the players array
  if (gameState.players.length > 0) {
    const currentIndex = gameState.players.findIndex(p => p.id === gameState.currentTurn);
    const nextIndex = (currentIndex + 1) % gameState.players.length;
    gameState.currentTurn = gameState.players[nextIndex].id;
  }
  updateTurnIndicator();
  updateResourceDisplays();
  broadcastGameState();
}

/* -------------- Global Game Controls -------------- */
function resetGame() {
  if (confirm('Reset the game?')) {
    location.reload();
  }
}
function forfeitGame() {
  if (confirm('Forfeit? Other players will be declared winners.')) {
    alert('You have forfeited.');
    // Additional forfeit logic would be implemented here.
  }
}

/* -------------- Drag & Drop Implementation -------------- */
function setupDragAndDrop() {
  // Allow cards (in hand or on the battlefield) to be draggable.
  document.querySelectorAll('.card').forEach(card => {
    card.setAttribute('draggable', true);
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
  });
  // Set drag listeners on all slots.
  document.querySelectorAll('.slot').forEach(slot => {
    slot.addEventListener('dragover', handleDragOver);
    slot.addEventListener('drop', handleDrop);
  });
}
function handleDragStart(e) {
  e.dataTransfer.setData('text/plain', e.target.id);
  e.target.classList.add('dragging');
}
function handleDragEnd(e) {
  e.target.classList.remove('dragging');
}
function handleDragOver(e) {
  e.preventDefault();
}
function handleDrop(e) {
  e.preventDefault();
  const cardId = e.dataTransfer.getData('text/plain');
  const cardElem = document.getElementById(cardId);
  e.currentTarget.appendChild(cardElem);
  const slotNumber = e.currentTarget.getAttribute('data-slot');
  // Send a moveCard action
  sendAction({
    action: 'moveCard',
    details: { cardId, slot: slotNumber }
  });
  updateCardSlot(cardId, slotNumber);
  broadcastGameState();
}

/* -------------- Card Interaction Functions -------------- */
function updateCardSlot(cardId, slotNumber) {
  // Update your gameState to reflect that the card with cardId is now in the given slot.
  // For simplicity, we assume gameState.battlefield[slotNumber] is an array of cardIds.
  if (!gameState.battlefield[slotNumber]) {
    gameState.battlefield[slotNumber] = [];
  }
  // Remove cardId from any other slot arrays:
  for (const slot in gameState.battlefield) {
    gameState.battlefield[slot] = gameState.battlefield[slot].filter(id => id !== cardId);
  }
  gameState.battlefield[slotNumber].push(cardId);
  console.log(`Card ${cardId} now in slot ${slotNumber}`);
}
function toggleFlipCard(cardId) {
  const cardElem = document.getElementById(cardId);
  cardElem.classList.toggle('flipped');
}
function rotateCard(cardId) {
  const cardElem = document.getElementById(cardId);
  let currentRotation = parseInt(cardElem.dataset.rotation || '0', 10);
  currentRotation = (currentRotation + 90) % 360;
  cardElem.style.transform = `rotate(${currentRotation}deg)`;
  cardElem.dataset.rotation = currentRotation;
}

/* -------------- Context Menu Functions -------------- */
function showContextMenu(x, y, target) {
  const menu = document.getElementById('context-menu');
  menu.style.top = y + 'px';
  menu.style.left = x + 'px';
  menu.classList.remove('hidden');
  menu.dataset.targetId = target.id;
}
function hideContextMenu() {
  const menu = document.getElementById('context-menu');
  menu.classList.add('hidden');
}
document.getElementById('context-menu').addEventListener('click', e => {
  if (e.target.tagName === 'LI') {
    const action = e.target.getAttribute('data-action');
    const targetId = document.getElementById('context-menu').dataset.targetId;
    performCardAction(action, targetId);
    hideContextMenu();
  }
});
function performCardAction(action, targetId) {
  switch(action) {
    case 'flip':
      sendAction({ action: 'flipCard', details: { cardId: targetId } });
      toggleFlipCard(targetId);
      break;
    case 'rotate':
      sendAction({ action: 'rotateCard', details: { cardId: targetId } });
      rotateCard(targetId);
      break;
    case 'zoom':
      zoomCard(targetId);
      break;
    case 'draw':
      // For simplicity, drawing a card moves the top card from deck into the hand.
      drawCard();
      break;
    case 'shuffle':
      shuffleDeck();
      break;
    case 'search':
      // Implement search logic as needed.
      alert('Search not implemented.');
      break;
    case 'reset-deck':
      resetDeck();
      break;
    default:
      console.log('No action defined for', action);
  }
}

/* -------------- Card Zoom Function -------------- */
function zoomCard(cardId) {
  const cardElem = document.getElementById(cardId);
  const overlay = document.createElement('div');
  overlay.classList.add('zoom-overlay');
  const zoomed = document.createElement('div');
  zoomed.classList.add('zoomed-card');
  // Use the card’s background image for zoomed view
  zoomed.style.backgroundImage = cardElem.style.backgroundImage;
  overlay.appendChild(zoomed);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => overlay.remove());
}

/* -------------- Deck Functions -------------- */
function drawCard() {
  // Remove the top card from gameState.deck and add it to the local player’s hand
  if (gameState.deck.length > 0) {
    const drawnCard = gameState.deck.shift();
    const localPlayer = gameState.players.find(p => p.id === gameState.peer.id);
    if (localPlayer) {
      localPlayer.hand.push(drawnCard);
      // Create a card element and add it to the hand UI
      const cardElem = createCardElement(drawnCard.id, drawnCard.image);
      document.getElementById('hand').appendChild(cardElem);
      setupDragAndDrop(); // Reinitialize drag listeners on new cards
      broadcastGameState();
    }
  } else {
    alert('Deck is empty.');
  }
}
function shuffleDeck() {
  // Simple Fisher–Yates shuffle
  for (let i = gameState.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gameState.deck[i], gameState.deck[j]] = [gameState.deck[j], gameState.deck[i]];
  }
  alert('Deck shuffled.');
  broadcastGameState();
}
function resetDeck() {
  // Reset the deck: move the hero card to slot 3 and reassemble the deck in slot 9
  // (In a full implementation, this would reinitialize the deck from the composite image)
  alert('Deck reset.');
  location.reload();
}

/* -------------- Send Action (Client/Host) -------------- */
function sendAction(actionData) {
  if (gameState.conn && gameState.conn.open) {
    gameState.conn.send(actionData);
  } else if (gameState.hostId) {
    // If host, process action locally and then broadcast
    handleIncomingAction(actionData);
  }
}

/* -------------- Card Element Creation -------------- */
function createCardElement(cardId, imageUrl) {
  const card = document.createElement('div');
  card.classList.add('card');
  card.id = `card-${cardId}`;
  card.style.backgroundImage = `url(${imageUrl})`;
  card.dataset.rotation = '0';
  card.setAttribute('draggable', true);
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);
  return card;
}

/* -------------- Deck Composite Image Slicing -------------- */
function sliceDeckImage() {
  // Load the composite image (assumed to be 7 rows x 10 columns)
  const img = new Image();
  img.src = 'assets/deck_composite.png';
  img.onload = () => {
    const rows = 7, cols = 10;
    const cardCount = 41; // Use first 41 cards
    const cardWidth = img.width / cols;
    const cardHeight = img.height / rows;
    const cardImages = [];
    const canvas = document.createElement('canvas');
    canvas.width = cardWidth;
    canvas.height = cardHeight;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < cardCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.clearRect(0, 0, cardWidth, cardHeight);
      ctx.drawImage(img, col * cardWidth, row * cardHeight, cardWidth, cardHeight, 0, 0, cardWidth, cardHeight);
      cardImages.push(canvas.toDataURL());
    }
    // Create deck objects from the card images and cardDatabase information.
    // Assume that cardDatabase is in the same order as the deck images.
    gameState.deck = [];
    for (let i = 0; i < cardImages.length; i++) {
      // Merge card data from cardDatabase with the sliced image.
      const cardData = cardDatabase[i] || { id: i+1, card_name: `Card ${i+1}` };
      cardData.image = cardImages[i];
      gameState.deck.push(cardData);
    }
    // Place the first card (hero) into the hero slot
    const heroCardData = gameState.deck.shift();
    const heroElem = createCardElement(heroCardData.id, heroCardData.image);
    document.querySelector('.hero-slot').appendChild(heroElem);
    // For the deck slot, show a card-back element
    const deckSlot = document.querySelector('.deck-slot');
    const deckBack = document.createElement('div');
    deckBack.classList.add('card', 'card-back');
    deckSlot.appendChild(deckBack);
  };
}
