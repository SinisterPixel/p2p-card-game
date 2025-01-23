/*********************************************************
 * main.js
 * Combines all Steps (1–8) + final polish (Step 9).
 *********************************************************/

/*********************************************************
 * Data Structures
 *********************************************************/
function createPlayer(id, name) {
  return {
    id: id,
    name: name,
    health: 40,
    lifeforce: 10,
    hand: [],
    isMyTurn: false,
    hasForfeited: false
  };
}

function createCard(cardId, front, back) {
  return {
    cardId: cardId,
    front: front,
    back: back,
    isFaceDown: true,
    orientation: 0,
    slot: null
  };
}

/*********************************************************
 * Game State
 *********************************************************/
const gameState = {
  players: [],
  currentPlayerIndex: 0,
  fieldSlots: [ [], [], [], [], [], [], [], [], [], [] ],
  deck: [],
  gameActive: false,

  // PeerJS-related
  isHost: false,
  peer: null,
  connections: [],
  hostId: null
};

/*********************************************************
 * Utility Functions
 *********************************************************/
function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function getRandomFirstTurn(playerCount) {
  return Math.floor(Math.random() * playerCount);
}

function clampHealth(health) {
  return Math.max(health, 0);
}

function clampLifeforce(lifeforce) {
  return clamp(lifeforce, 0, 10);
}

/*********************************************************
 * PeerJS Setup
 *********************************************************/
function initPeerJS() {
  const urlParams = new URLSearchParams(window.location.search);
  const joinId = urlParams.get("joinId");

  if (!joinId) {
    // We are the host
    gameState.isHost = true;
    gameState.peer = new Peer();

    gameState.peer.on("open", (id) => {
      console.log("Host PeerJS ID:", id);
      gameState.hostId = id;
      initGameAsHost();
    });

    gameState.peer.on("connection", (conn) => {
      console.log("Incoming connection from", conn.peer);
      setupDataConnection(conn);
      gameState.connections.push(conn);
      // We could also add logic to dynamically add them as a player, etc.
    });

  } else {
    // We are a client
    gameState.isHost = false;
    gameState.hostId = joinId;
    gameState.peer = new Peer();

    gameState.peer.on("open", (id) => {
      console.log("Client PeerJS ID:", id);
      const conn = gameState.peer.connect(gameState.hostId);
      conn.on("open", () => {
        console.log("Connected to host:", gameState.hostId);
        setupDataConnection(conn);
        gameState.connections.push(conn);
      });
    });
  }
}

function setupDataConnection(conn) {
  conn.on("data", (message) => {
    handlePeerMessage(conn, message);
  });

  conn.on("close", () => {
    console.log("Connection closed:", conn.peer);
    gameState.connections = gameState.connections.filter((c) => c !== conn);
  });

  conn.on("error", (err) => {
    console.error("Connection error:", err);
  });
}

/*********************************************************
 * Message Handling
 *********************************************************/
function handlePeerMessage(conn, message) {
  switch (message.type) {
    case "REQUEST_GAME_STATE":
      if (gameState.isHost) {
        broadcastGameState(conn);
      }
      break;

    case "SYNC_GAME_STATE":
      if (!gameState.isHost) {
        updateGameStateFromHost(message.payload);
      }
      break;

    case "PLAYER_ACTION":
      if (gameState.isHost) {
        handlePlayerAction(conn, message.payload);
      }
      break;

    default:
      console.warn("Unknown message type:", message.type);
  }
}

function broadcastGameState(targetConn) {
  const stateToSend = JSON.parse(JSON.stringify(gameState));
  const message = {
    type: "SYNC_GAME_STATE",
    payload: stateToSend
  };
  if (targetConn) {
    targetConn.send(message);
  } else {
    for (let c of gameState.connections) {
      c.send(message);
    }
  }
}

function updateGameStateFromHost(hostState) {
  Object.assign(gameState, hostState);
  refreshUI();
}

/*********************************************************
 * Host Initialization
 *********************************************************/
function initGameAsHost() {
  // Example: Two players (p1 = host, p2 = client)
  gameState.players = [
    createPlayer("p1", "Player 1"),
    createPlayer("p2", "Player 2")
  ];

  // Create 41 cards
  gameState.deck = [];
  for (let i = 0; i < 41; i++) {
    const card = createCard(
      `card-${i}`,
      `assets/front-${i}.png`,
      `assets/back.png`
    );
    gameState.deck.push(card);
  }

  // Decide who goes first randomly
  gameState.currentPlayerIndex = getRandomFirstTurn(gameState.players.length);
  gameState.players[gameState.currentPlayerIndex].isMyTurn = true;
  gameState.gameActive = true;

  // Optionally place hero & deck
  applyDeckReset();

  console.log("Host initialized gameState:", gameState);
  broadcastGameState();
}

/*********************************************************
 * End Turn Logic (Host)
 *********************************************************/
function endTurn(playerId) {
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  if (currentPlayer.id !== playerId) {
    console.log("Invalid endTurn: not current player's ID.");
    return;
  }

  // Move to next player
  currentPlayer.isMyTurn = false;
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
  const nextPlayer = gameState.players[gameState.currentPlayerIndex];
  nextPlayer.isMyTurn = true;

  // Start-of-turn lifeforce +5 (max 10)
  nextPlayer.lifeforce = clampLifeforce(nextPlayer.lifeforce + 5);

  console.log(`End turn for ${playerId}, next player: ${nextPlayer.name}`);
}

/*********************************************************
 * Resource Updates
 *********************************************************/
function applyResourceUpdate(playerId, resourceType, newValue) {
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) return;

  if (resourceType === "health") {
    player.health = clampHealth(newValue);
  } else if (resourceType === "lifeforce") {
    player.lifeforce = clampLifeforce(newValue);
  }
}

/*********************************************************
 * Forfeit
 *********************************************************/
function applyForfeit(playerId) {
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) return;
  player.hasForfeited = true;

  const activePlayers = gameState.players.filter(p => !p.hasForfeited);
  if (activePlayers.length <= 1) {
    console.log("Game ends due to forfeit. Winner:", activePlayers[0]?.name || "None");
    gameState.gameActive = false;
  }
}

/*********************************************************
 * Deck Reset
 *********************************************************/
function applyDeckReset() {
  // Clear slots
  for (let slotArr of gameState.fieldSlots) slotArr.length = 0;
  // Clear hands
  for (let p of gameState.players) p.hand = [];

  // Must have at least 41 cards
  if (gameState.deck.length < 41) {
    console.warn("Not enough cards for deck reset.");
    return;
  }

  const heroCard = gameState.deck[0];
  // Slot 3 => index 2
  gameState.fieldSlots[2].push(heroCard);

  // Next 40 cards => slot 9 => index 8
  for (let i = 1; i < 41; i++) {
    gameState.fieldSlots[8].push(gameState.deck[i]);
  }
}

/*********************************************************
 * Game Reset
 *********************************************************/
function applyGameReset() {
  console.log("Game reset initiated.");

  // Re-init players
  for (let p of gameState.players) {
    p.health = 40;
    p.lifeforce = 10;
    p.hand = [];
    p.hasForfeited = false;
    p.isMyTurn = false;
  }

  // Clear field
  for (let slotArr of gameState.fieldSlots) slotArr.length = 0;

  // Rebuild deck
  gameState.deck = [];
  for (let i = 0; i < 41; i++) {
    const card = createCard(`card-${i}`, `assets/front-${i}.png`, `assets/back.png`);
    gameState.deck.push(card);
  }

  // Random turn
  gameState.currentPlayerIndex = getRandomFirstTurn(gameState.players.length);
  gameState.players[gameState.currentPlayerIndex].isMyTurn = true;
  gameState.gameActive = true;

  // Place hero + deck
  applyDeckReset();
}

/*********************************************************
 * Move Card to Slot
 *********************************************************/
function moveCardToSlot(cardId, slotIndex, fromHand, fromSlotIndex) {
  let card = null;

  if (fromHand) {
    // Find card in any player's hand
    for (let player of gameState.players) {
      const idx = player.hand.findIndex(c => c.cardId === cardId);
      if (idx !== -1) {
        card = player.hand[idx];
        player.hand.splice(idx, 1);
        break;
      }
    }
  } else if (fromSlotIndex !== null) {
    const stack = gameState.fieldSlots[fromSlotIndex];
    const idx = stack.findIndex(c => c.cardId === cardId);
    if (idx !== -1) {
      card = stack[idx];
      stack.splice(idx, 1);
    }
  }

  if (!card) {
    console.warn("moveCardToSlot: Card not found:", cardId);
    return;
  }

  gameState.fieldSlots[slotIndex].push(card);
  card.slot = slotIndex;
}

/*********************************************************
 * Player Actions (Host)
 *********************************************************/
function handlePlayerAction(conn, actionPayload) {
  switch (actionPayload.action) {
    case "END_TURN":
      endTurn(actionPayload.playerId);
      break;

    case "MOVE_CARD_TO_SLOT":
      moveCardToSlot(
        actionPayload.cardId,
        actionPayload.slotIndex,
        actionPayload.fromHand,
        actionPayload.fromSlotIndex
      );
      break;

    case "CONTEXT_ACTION": {
      const { actionType, target } = actionPayload;
      const reconstructed = reconstructTargetFromClient(target);
      applyContextAction(actionType, reconstructed);
      break;
    }

    case "UPDATE_RESOURCE":
      applyResourceUpdate(actionPayload.playerId, actionPayload.resourceType, actionPayload.newValue);
      break;

    case "FORFEIT":
      applyForfeit(actionPayload.playerId);
      break;

    case "DECK_RESET":
      applyDeckReset();
      break;

    case "GAME_RESET":
      applyGameReset();
      break;

    default:
      console.log("Unrecognized action:", actionPayload);
  }
  broadcastGameState();
}

/*********************************************************
 * Reconstruct Target from Client (Security)
 *********************************************************/
function reconstructTargetFromClient(clientTarget) {
  let result = {
    isSlot: clientTarget.isSlot,
    slotIndex: null,
    stack: [],
    isHandCard: clientTarget.isHandCard,
    cardObject: null
  };

  if (clientTarget.isSlot && typeof clientTarget.slotIndex === "number") {
    result.slotIndex = clientTarget.slotIndex;
    result.stack = gameState.fieldSlots[clientTarget.slotIndex] || [];
  }
  if (clientTarget.isHandCard && clientTarget.cardObject) {
    const realCard = findCardInAllHands(clientTarget.cardObject.cardId);
    if (realCard) {
      result.cardObject = realCard;
    }
  }
  return result;
}

function findCardInAllHands(cardId) {
  for (let p of gameState.players) {
    for (let c of p.hand) {
      if (c.cardId === cardId) return c;
    }
  }
  return null;
}

/*********************************************************
 * Context Actions
 *********************************************************/
function applyContextAction(actionType, targetInfo) {
  switch (actionType) {
    case "FLIP":
      flipTopCard(targetInfo);
      break;
    case "ROTATE":
      rotateTopCard(targetInfo);
      break;
    case "ZOOM":
      // Only open locally on the host side
      openZoomModal(getTopCard(targetInfo));
      break;
    case "SEARCH":
      openSearchModal(targetInfo);
      break;
    case "SHUFFLE":
      shuffleStack(targetInfo.stack);
      break;
    case "DRAW":
      drawTopCard(targetInfo);
      break;
    default:
      console.log("Unknown context action:", actionType);
  }
}

function getTopCard(targetInfo) {
  if (targetInfo.isSlot && targetInfo.stack.length > 0) {
    return targetInfo.stack[targetInfo.stack.length - 1];
  } else if (targetInfo.isHandCard && targetInfo.cardObject) {
    return targetInfo.cardObject;
  }
  return null;
}

function flipTopCard(targetInfo) {
  const card = getTopCard(targetInfo);
  if (card) card.isFaceDown = !card.isFaceDown;
}

function rotateTopCard(targetInfo) {
  const card = getTopCard(targetInfo);
  if (card) card.orientation = (card.orientation + 90) % 360;
}

function openZoomModal(card) {
  if (!card) return;
  let zoomOverlay = document.getElementById("zoom-overlay");
  let zoomContent = document.getElementById("zoom-content");
  if (!zoomOverlay || !zoomContent) return;

  const imgSrc = card.isFaceDown ? card.back : card.front;
  zoomContent.style.backgroundImage = `url(${imgSrc})`;

  zoomOverlay.style.display = "block";
  // Close on click
  zoomOverlay.onclick = () => {
    zoomOverlay.style.display = "none";
  };
}

function openSearchModal(targetInfo) {
  let overlay = document.getElementById("search-modal-overlay");
  let content = document.getElementById("search-modal-content");
  if (!overlay || !content) return;

  content.innerHTML = `<h2>Search Results</h2>`;
  const stack = targetInfo.stack;
  stack.forEach(card => {
    let cardElem = document.createElement("div");
    cardElem.classList.add("card");
    cardElem.style.backgroundImage = `url(${card.isFaceDown ? card.back : card.front})`;
    // Let user drag the card out
    cardElem.draggable = true;
    cardElem.ondragstart = () => {
      draggedCardData = {
        cardId: card.cardId,
        fromHand: false,
        fromSlotIndex: targetInfo.slotIndex
      };
    };
    content.appendChild(cardElem);
  });

  overlay.style.display = "block";
  overlay.onclick = (evt) => {
    if (evt.target === overlay) {
      overlay.style.display = "none";
      content.innerHTML = "";
    }
  };
}

function shuffleStack(stack) {
  for (let i = stack.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [stack[i], stack[j]] = [stack[j], stack[i]];
  }
}

function drawTopCard(targetInfo) {
  const topCard = getTopCard(targetInfo);
  if (!topCard) return;
  targetInfo.stack.pop(); // remove from stack
  // Give it to the current player
  const currentP = gameState.players[gameState.currentPlayerIndex];
  currentP.hand.push(topCard);
}

/*********************************************************
 * Client -> Host Player Actions
 *********************************************************/
function sendPlayerAction(payload) {
  const hostConn = gameState.connections[0];
  if (!hostConn) return;
  hostConn.send({
    type: "PLAYER_ACTION",
    payload
  });
}

/*********************************************************
 * Rendering / UI
 *********************************************************/

// Track a card being dragged
let draggedCardData = null;

function refreshUI() {
  renderFieldSlots();
  renderPlayerHands();
  renderTurnIndicator();
  renderPlayerStats();
}

function renderFieldSlots() {
  const fieldContainer = document.getElementById("field");
  if (!fieldContainer) return;

  Array.from(fieldContainer.children).forEach((slotElem) => {
    slotElem.innerHTML = "";
  });

  for (let slotIndex = 0; slotIndex < 10; slotIndex++) {
    const slotElem = fieldContainer.querySelector(`[data-slot="${slotIndex+1}"]`);
    if (!slotElem) continue;

    slotElem.ondragover = (evt) => {
      evt.preventDefault();
    };
    slotElem.ondrop = (evt) => {
      evt.preventDefault();
      handleDropOnSlot(slotIndex);
    };
    slotElem.oncontextmenu = (evt) => {
      const stack = gameState.fieldSlots[slotIndex];
      openContextMenu(evt, {
        isSlot: true,
        slotIndex: slotIndex,
        stack: stack,
        isHandCard: false
      });
    };

    const stack = gameState.fieldSlots[slotIndex];
    if (stack.length > 0) {
      const topCard = stack[stack.length - 1];
      const cardElem = createCardElement(topCard, false);

      if (stack.length > 1) {
        const stackCountBadge = document.createElement("div");
        stackCountBadge.classList.add("stack-count-badge");
        stackCountBadge.innerText = stack.length;
        cardElem.appendChild(stackCountBadge);
      }

      cardElem.oncontextmenu = (evt) => {
        openContextMenu(evt, {
          isSlot: true,
          slotIndex: slotIndex,
          stack: stack,
          isHandCard: false
        });
      };

      slotElem.appendChild(cardElem);
    }
  }
}

function renderPlayerHands() {
  const handArea = document.getElementById("hand-area");
  if (!handArea) return;

  Array.from(handArea.children).forEach((pHand) => {
    const label = pHand.getAttribute("data-player") + " Hand";
    pHand.innerHTML = `<h3>${label}</h3>`;
  });

  gameState.players.forEach((player) => {
    const selector = `.player-hand[data-player="${player.name}"]`;
    const handElem = handArea.querySelector(selector);
    if (!handElem) return;

    player.hand.forEach((card) => {
      const isLocal = isThisLocalPlayer(player);
      const cardElem = createCardElement(card, isLocal);
      if (isLocal) {
        cardElem.draggable = true;
        cardElem.ondragstart = () => {
          draggedCardData = {
            cardId: card.cardId,
            fromHand: true,
            fromSlotIndex: null
          };
        };
      }
      cardElem.oncontextmenu = (evt) => {
        if (isLocal) {
          openContextMenu(evt, {
            isSlot: false,
            slotIndex: null,
            stack: [],
            isHandCard: true,
            cardObject: card
          });
        } else {
          evt.preventDefault();
        }
      };
      handElem.appendChild(cardElem);
    });
  });
}

function renderTurnIndicator() {
  const elem = document.getElementById("current-player");
  if (!elem) return;
  const currP = gameState.players[gameState.currentPlayerIndex];
  elem.innerText = currP ? currP.name : "???";
}

function renderPlayerStats() {
  const statsArea = document.getElementById("player-stats");
  if (!statsArea) return;
  statsArea.innerHTML = "";

  gameState.players.forEach((player) => {
    const div = document.createElement("div");
    div.classList.add("player-stat");

    const isLocal = isThisLocalPlayer(player);

    div.innerHTML = `
      <h3>${player.name}</h3>
      <p>
        Health: <span class="health-value">${player.health}</span>
        ${isLocal ? `<button class="health-minus">-</button><button class="health-plus">+</button>` : ""}
      </p>
      <p>
        Lifeforce: <span class="lifeforce-value">${player.lifeforce}</span>
        ${isLocal ? `<button class="life-minus">-</button><button class="life-plus">+</button>` : ""}
      </p>
    `;

    statsArea.appendChild(div);

    if (isLocal) {
      const hm = div.querySelector(".health-minus");
      const hp = div.querySelector(".health-plus");
      const lm = div.querySelector(".life-minus");
      const lp = div.querySelector(".life-plus");

      hm.onclick = () => updatePlayerResource(player.id, "health", player.health - 1);
      hp.onclick = () => updatePlayerResource(player.id, "health", player.health + 1);
      lm.onclick = () => updatePlayerResource(player.id, "lifeforce", player.lifeforce - 1);
      lp.onclick = () => updatePlayerResource(player.id, "lifeforce", player.lifeforce + 1);
    }
  });
}

function createCardElement(card, faceUp) {
  const cardElem = document.createElement("div");
  cardElem.classList.add("card");
  const imgSrc = faceUp && !card.isFaceDown ? card.front : card.back;
  cardElem.style.backgroundImage = `url(${imgSrc})`;
  cardElem.dataset.cardId = card.cardId;
  cardElem.style.transform = `rotate(${card.orientation}deg)`;
  return cardElem;
}

/*********************************************************
 * Drag-and-Drop Helpers
 *********************************************************/
function handleDropOnSlot(slotIndex) {
  if (!draggedCardData) return;
  if (gameState.isHost) {
    moveCardToSlot(draggedCardData.cardId, slotIndex, draggedCardData.fromHand, draggedCardData.fromSlotIndex);
    broadcastGameState();
  } else {
    sendPlayerAction({
      action: "MOVE_CARD_TO_SLOT",
      cardId: draggedCardData.cardId,
      slotIndex,
      fromHand: draggedCardData.fromHand,
      fromSlotIndex: draggedCardData.fromSlotIndex
    });
  }
  draggedCardData = null;
}

/*********************************************************
 * Context Menu
 *********************************************************/
let contextTarget = {};

function getContextMenuElement() {
  let menu = document.getElementById("context-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "context-menu";
    menu.style.display = "none";
    document.body.appendChild(menu);
  }
  return menu;
}

function openContextMenu(evt, targetInfo) {
  evt.preventDefault();
  closeContextMenu();
  contextTarget = targetInfo;
  const menu = getContextMenuElement();
  menu.innerHTML = "";

  const actions = determineContextActions(targetInfo);
  actions.forEach(action => {
    const btn = document.createElement("button");
    btn.innerText = action.label;
    btn.onclick = () => {
      closeContextMenu();
      handleContextAction(action.type);
    };
    menu.appendChild(btn);
  });

  menu.style.display = "block";
  menu.style.left = evt.pageX + "px";
  menu.style.top = evt.pageY + "px";
}

function closeContextMenu() {
  const menu = getContextMenuElement();
  menu.style.display = "none";
}

function determineContextActions(targetInfo) {
  const actions = [];
  if (targetInfo.isSlot && targetInfo.stack.length > 0) {
    actions.push({ type: "FLIP", label: "Flip Top Card" });
    actions.push({ type: "ROTATE", label: "Rotate Top Card" });
    actions.push({ type: "ZOOM", label: "Zoom Top Card" });
    actions.push({ type: "SEARCH", label: "Search Stack" });
    actions.push({ type: "SHUFFLE", label: "Shuffle Stack" });
    actions.push({ type: "DRAW", label: "Draw Top Card" });
  } else if (targetInfo.isHandCard && targetInfo.cardObject) {
    actions.push({ type: "FLIP", label: "Flip Card" });
    actions.push({ type: "ROTATE", label: "Rotate Card" });
    actions.push({ type: "ZOOM", label: "Zoom Card" });
  }
  return actions;
}

function handleContextAction(actionType) {
  if (gameState.isHost) {
    applyContextAction(actionType, contextTarget);
    broadcastGameState();
  } else {
    sendPlayerAction({
      action: "CONTEXT_ACTION",
      actionType: actionType,
      target: contextTarget
      // In production, only send minimal data: { slotIndex, cardId, etc. }
    });
  }
}

/*********************************************************
 * Checking Local Player
 *********************************************************/
function isThisLocalPlayer(player) {
  // Simple assumption: host = "p1", client = "p2", etc.
  if (gameState.isHost && player.id === "p1") return true;
  if (!gameState.isHost && player.id === "p2") return true;
  return false;
}

/*********************************************************
 * End Turn Button
 *********************************************************/
function setupEndTurnButton() {
  const btn = document.getElementById("end-turn-btn");
  if (!btn) return;
  btn.onclick = () => {
    const currentP = gameState.players[gameState.currentPlayerIndex];
    if (isThisLocalPlayer(currentP)) {
      if (gameState.isHost) {
        endTurn(currentP.id);
        broadcastGameState();
      } else {
        sendPlayerAction({ action: "END_TURN", playerId: currentP.id });
      }
    } else {
      console.log("Not your turn, cannot end turn.");
    }
  };
}

/*********************************************************
 * Update Player Resource (Local -> Host)
 *********************************************************/
function updatePlayerResource(playerId, resourceType, newValue) {
  if (gameState.isHost) {
    applyResourceUpdate(playerId, resourceType, newValue);
    broadcastGameState();
  } else {
    sendPlayerAction({
      action: "UPDATE_RESOURCE",
      playerId,
      resourceType,
      newValue
    });
  }
}

/*********************************************************
 * Window On Load
 *********************************************************/
window.addEventListener("DOMContentLoaded", () => {
  initPeerJS();
  setupEndTurnButton();

  // Forfeit, Deck Reset, Game Reset buttons
  const forfeitBtn = document.getElementById("forfeit-btn");
  if (forfeitBtn) {
    forfeitBtn.onclick = () => {
      if (confirm("Are you sure you want to forfeit?")) {
        const localPlayer = gameState.players.find(p => isThisLocalPlayer(p));
        if (!localPlayer) return;
        if (gameState.isHost) {
          applyForfeit(localPlayer.id);
          broadcastGameState();
        } else {
          sendPlayerAction({ action: "FORFEIT", playerId: localPlayer.id });
        }
      }
    };
  }

  const deckResetBtn = document.getElementById("deck-reset-btn");
  if (deckResetBtn) {
    deckResetBtn.onclick = () => {
      if (confirm("Are you sure you want to reset the deck?")) {
        if (gameState.isHost) {
          applyDeckReset();
          broadcastGameState();
        } else {
          sendPlayerAction({ action: "DECK_RESET" });
        }
      }
    };
  }

  const gameResetBtn = document.getElementById("game-reset-btn");
  if (gameResetBtn) {
    gameResetBtn.onclick = () => {
      if (confirm("Are you sure you want to reset the game?")) {
        if (gameState.isHost) {
          applyGameReset();
          broadcastGameState();
        } else {
          sendPlayerAction({ action: "GAME_RESET" });
        }
      }
    };
  }
});
