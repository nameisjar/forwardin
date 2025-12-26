# Socket.IO Events Documentation

> **Last Updated**: December 26, 2025

## Overview

This document describes all Socket.IO events used for real-time communication between the backend (forwardin) and frontend (fe-autosender).

---

## Connection Setup

### Client Configuration

```javascript
import { io } from 'socket.io-client';

const socket = io(API_BASE, {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 10,
  transports: ['websocket', 'polling'],
  auth: {
    token: localStorage.getItem('token'),
  },
});
```

### Authentication
Socket connections can be authenticated or unauthenticated:
- **Authenticated**: Include JWT token in `auth.token`
- **Unauthenticated**: Connect without token (limited features)

---

## Events Reference

### Device Status Events

#### `device:{deviceId}:status`
Emitted when device connection status changes.

| Direction | From Backend → To Frontend |
|-----------|---------------------------|
| **Event Name** | `device:{deviceId}:status` |
| **Trigger** | Device connects/disconnects from WhatsApp |

**Payload:**
```typescript
type ConnectionStatus = "open" | "connecting" | "close" | "qr";

// Example: "device:abc123:status" → "open"
string
```

**Frontend Handler:**
```javascript
export function listenToDeviceStatus(deviceId, callback) {
  const socket = connectSocket();
  const eventName = `device:${deviceId}:status`;

  socket.on(eventName, (status) => {
    callback(status);
  });

  return () => socket.off(eventName);
}
```

**Usage in Vue Component:**
```javascript
onMounted(() => {
  const cleanup = listenToDeviceStatus(deviceId, (status) => {
    device.value.status = status;
  });
  onUnmounted(cleanup);
});
```

---

### Group Events

#### `device:{deviceId}:groups-updated`
Emitted when any group-related change occurs.

| Direction | From Backend → To Frontend |
|-----------|---------------------------|
| **Event Name** | `device:{deviceId}:groups-updated` |
| **Trigger** | Group joined, left, updated, or participants changed |

**Payload:**
```typescript
interface GroupsUpdatedPayload {
  action: 'group-joined' | 'group-left' | 'group-updated' | 'participants-updated';
  groupId: string;
  timestamp: string; // ISO 8601
}
```

**Frontend Handler:**
```javascript
export function listenToGroupUpdates(deviceId, callback) {
  const socket = connectSocket();
  const eventName = `device:${deviceId}:groups-updated`;

  socket.on(eventName, (data) => {
    callback(data);
  });

  return () => socket.off(eventName);
}
```

---

#### `device:{deviceId}:group-joined`
Emitted when device joins a new WhatsApp group.

| Direction | From Backend → To Frontend |
|-----------|---------------------------|
| **Event Name** | `device:{deviceId}:group-joined` |
| **Trigger** | Device added to a WhatsApp group |

**Payload:**
```typescript
interface GroupJoinedPayload {
  groupId: string;
  groupName: string;
  participants: number;
  isActive: boolean;
  sessionId: string;
}
```

**Frontend Handler:**
```javascript
export function listenToNewGroup(deviceId, callback) {
  const socket = connectSocket();
  const eventName = `device:${deviceId}:group-joined`;

  socket.on(eventName, (groupData) => {
    callback(groupData);
  });

  return () => socket.off(eventName);
}
```

---

#### `device:{deviceId}:group-left`
Emitted when device leaves or is kicked from a WhatsApp group.

| Direction | From Backend → To Frontend |
|-----------|---------------------------|
| **Event Name** | `device:{deviceId}:group-left` |
| **Trigger** | Device removed from a WhatsApp group |

**Payload:**
```typescript
interface GroupLeftPayload {
  groupId: string;
  action: 'remove';
  timestamp: string; // ISO 8601
}
```

**Frontend Handler:**
```javascript
export function listenToGroupLeft(deviceId, callback) {
  const socket = connectSocket();
  const eventName = `device:${deviceId}:group-left`;

  socket.on(eventName, (data) => {
    callback(data);
  });

  return () => socket.off(eventName);
}
```

---

### Monitoring Events (Admin Only)

#### Subscribing to Monitoring

```javascript
// Subscribe (admin only)
socket.emit('monitoring:subscribe');

// Unsubscribe
socket.emit('monitoring:unsubscribe');
```

**Error Response (if not admin):**
```typescript
socket.on('error', (error) => {
  // error: { code: 'ACCESS_DENIED', message: 'Monitoring requires admin privileges' }
});
```

---

#### `monitoring:update`
Periodic update of system status (every 10 seconds).

| Direction | From Backend → To Frontend |
|-----------|---------------------------|
| **Event Name** | `monitoring:update` |
| **Trigger** | Every 10 seconds while subscribed |

**Payload:**
```typescript
interface MonitoringUpdatePayload {
  pdfGenerator: {
    isProcessing: boolean;
    queueLength: number;
    currentTask?: string;
    completedToday: number;
    failedToday: number;
  };
  timestamp: string; // ISO 8601
}
```

---

#### `monitoring:device`
Real-time device status changes for monitoring.

| Direction | From Backend → To Frontend |
|-----------|---------------------------|
| **Event Name** | `monitoring:device` |
| **Trigger** | Any device status change |

**Payload:**
```typescript
interface MonitoringDevicePayload {
  deviceId: string;
  status: string;
  isConnected: boolean;
  timestamp: string; // ISO 8601
}
```

---

#### `monitoring:message`
Real-time message events for monitoring.

| Direction | From Backend → To Frontend |
|-----------|---------------------------|
| **Event Name** | `monitoring:message` |
| **Trigger** | Message sent via any device |

**Payload:**
```typescript
interface MonitoringMessagePayload {
  deviceId: string;
  status: 'sent' | 'failed' | 'pending';
  broadcastType?: string;
  timestamp: string; // ISO 8601
}
```

---

## Event Flow Diagrams

### Device Connection Flow
```
┌─────────────┐    QR Generated     ┌─────────────┐
│   Backend   │ ──────────────────► │  Frontend   │
└─────────────┘  device:X:status    └─────────────┘
                     = "qr"

┌─────────────┐    User Scans QR    ┌─────────────┐
│   Backend   │ ──────────────────► │  Frontend   │
└─────────────┘  device:X:status    └─────────────┘
                  = "connecting"

┌─────────────┐    Connected!       ┌─────────────┐
│   Backend   │ ──────────────────► │  Frontend   │
└─────────────┘  device:X:status    └─────────────┘
                    = "open"
```

### Group Sync Flow
```
┌─────────────┐    Device Joins     ┌─────────────┐
│  WhatsApp   │ ──────────────────► │   Backend   │
└─────────────┘    New Group        └─────────────┘
                                          │
                                          │ Save to DB
                                          ▼
                                    ┌─────────────┐
                                    │   Prisma    │
                                    └─────────────┘
                                          │
                                          │ Emit Events
                                          ▼
┌─────────────┐  group-joined       ┌─────────────┐
│  Frontend   │ ◄────────────────── │  Socket.IO  │
└─────────────┘  groups-updated     └─────────────┘
```

---

## Best Practices

### 1. Always Clean Up Listeners
```javascript
// In Vue component
onMounted(() => {
  const cleanup = listenToDeviceStatus(deviceId, handler);
  onUnmounted(cleanup);
});
```

### 2. Reconnect on Token Refresh
```javascript
import { refreshSocketAuth } from './socket';

// After login or token refresh
refreshSocketAuth();
```

### 3. Handle Disconnections
```javascript
socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') {
    // Server disconnected, need to manually reconnect
    socket.connect();
  }
  // Other reasons will auto-reconnect
});
```

### 4. Use Specific Event Names
Instead of listening to generic events, listen to device-specific events:
```javascript
// ✅ Good
socket.on(`device:${deviceId}:status`, handler);

// ❌ Bad - catches all devices
socket.on('device:status', handler);
```

---

## Troubleshooting

### Socket Not Connecting
1. Check if token is valid in localStorage
2. Verify CORS settings on backend (CLIENT_URL1, CLIENT_URL2)
3. Check network/firewall settings

### Events Not Received
1. Ensure socket is connected: `socket.connected`
2. Check if listening to correct event name
3. Verify device ID format matches backend

### Admin Events Not Working
1. Ensure user has admin privileges
2. Call `monitoring:subscribe` after connection
3. Check for `error` events with ACCESS_DENIED code

---

## Complete Event List

| Event Name | Direction | Auth Required | Description |
|------------|-----------|---------------|-------------|
| `device:{id}:status` | Server → Client | No | Device connection status |
| `device:{id}:groups-updated` | Server → Client | No | Group list changed |
| `device:{id}:group-joined` | Server → Client | No | Joined new group |
| `device:{id}:group-left` | Server → Client | No | Left/kicked from group |
| `monitoring:subscribe` | Client → Server | Admin | Subscribe to monitoring |
| `monitoring:unsubscribe` | Client → Server | No | Unsubscribe from monitoring |
| `monitoring:update` | Server → Client | Admin | System status update |
| `monitoring:device` | Server → Client | Admin | Device status for monitoring |
| `monitoring:message` | Server → Client | Admin | Message event for monitoring |
| `error` | Server → Client | No | Error notification |
