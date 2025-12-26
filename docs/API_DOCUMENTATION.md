# API Documentation - Forwardin Backend

> **Last Updated**: December 26, 2025

## Table of Contents
- [Authentication](#authentication)
- [Base URL](#base-url)
- [API Routes Overview](#api-routes-overview)
- [Detailed Endpoints](#detailed-endpoints)

---

## Authentication

### JWT Token Authentication
Most endpoints require JWT token authentication via Bearer token.

```http
Authorization: Bearer <your_jwt_token>
```

### Device API Token Authentication
Device API routes (`/api/*`) require device access token.

```http
Authorization: <device_access_token>
```

### API Key Authentication (External)
External API routes (`/api-external/*`) require API key.

```http
X-API-Key: <your_api_key>
```

---

## Base URL

| Environment | URL |
|-------------|-----|
| Development | `http://localhost:3000` |
| Production | `https://your-production-url.com` |

---

## API Routes Overview

| Route Prefix | Description | Auth Type |
|--------------|-------------|-----------|
| `/auth` | Authentication (login, register) | None/JWT |
| `/users` | User management | JWT |
| `/tutors` | Tutor management | JWT |
| `/devices` | Device management | JWT |
| `/sessions` | WhatsApp session management | JWT |
| `/contacts` | Contact management | JWT |
| `/groups` | Internal contact groups | JWT |
| `/wa-groups` | WhatsApp groups | JWT |
| `/broadcasts` | Broadcast management | JWT |
| `/snippets` | Code snippets | JWT/Public |
| `/algorithmics` | Monthly templates | JWT |
| `/course` | Course feedback | JWT |
| `/api` | Device API (send messages, etc.) | Device Token |
| `/api-external` | External API | API Key |

---

## Detailed Endpoints

### Authentication (`/auth`)

#### POST `/auth/login`
Login user and get JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "email": "user@example.com",
    "privilege": { "name": "User" }
  }
}
```

#### GET `/auth/me`
Get current authenticated user info.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "email": "user@example.com",
  "privilege": {
    "pkId": 2,
    "name": "User"
  }
}
```

---

### Users (`/users`)

#### GET `/users`
Get all users (admin only).

#### PATCH `/users/:userId`
Update user info.

#### PATCH `/users/change-email/:userId`
Change user email.

#### PATCH `/users/change-phone-number/:userId`
Change user phone number.

#### DELETE `/users/:userId`
Delete user.

---

### Tutors (`/tutors`)

#### GET `/tutors/me`
Get current tutor profile.

#### POST `/tutors`
Create new tutor (admin only).

**Request Body:**
```json
{
  "email": "tutor@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### GET `/tutors`
List all tutors (admin only).

#### GET `/tutors/messages/outgoing`
Get all outgoing messages (admin only).

#### DELETE `/tutors/messages/outgoing`
Delete all outgoing messages (admin only).

#### POST `/tutors/devices`
Create device for tutor (no subscription check).

#### GET `/tutors/messages`
Get tutor's messages.

#### POST `/tutors/sessions/create-sse`
Create SSE session for tutor.

#### GET `/tutors/wa-groups`
List WhatsApp groups for tutor.

#### GET `/tutors/devices/stats`
Get all devices stats.

#### GET `/tutors/devices/:deviceId/stats`
Get single device stats.

---

### Devices (`/devices`)

#### GET `/devices`
Get all devices for current user.

**Query Parameters:**
- `page` (number): Page number
- `pageSize` (number): Items per page

**Response:**
```json
{
  "data": [
    {
      "id": "device-uuid",
      "name": "My Device",
      "status": "open",
      "phone": "628123456789",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "totalCount": 10
}
```

#### GET `/devices/:id`
Get single device by ID.

#### POST `/devices`
Create new device.

**Request Body:**
```json
{
  "name": "My WhatsApp Device"
}
```

#### PUT `/devices/:id`
Update device info.

#### DELETE `/devices`
Delete multiple devices.

**Request Body:**
```json
{
  "ids": ["device-uuid-1", "device-uuid-2"]
}
```

#### GET `/devices/:id/labels`
Get device labels.

#### POST `/devices/:id/access-token`
Issue access token for device.

#### POST `/devices/:id/generate-api-key`
Generate API key for device.

#### GET `/devices/:id/health`
Get device health status.

**Response:**
```json
{
  "deviceId": "device-uuid",
  "isHealthy": true,
  "status": "open",
  "lastMessageAt": "2025-01-01T10:00:00.000Z",
  "errorRate": 0.02
}
```

#### GET `/devices/:id/signals`
Get device signals history.

#### POST `/devices/:id/pause`
Pause device (stop sending messages).

#### POST `/devices/:id/resume`
Resume device (continue sending messages).

---

### Sessions (`/sessions`)

#### GET `/sessions/:deviceId/status`
Get session status.

#### POST `/sessions/:deviceId/create`
Create new WhatsApp session.

#### DELETE `/sessions/:deviceId`
Delete/logout session.

#### GET `/sessions/:deviceId/profile`
Get WhatsApp profile.

#### PUT `/sessions/:deviceId/profile`
Update WhatsApp profile.

---

### Contacts (`/contacts`)

#### GET `/contacts`
Get contacts with pagination.

**Query Parameters:**
- `deviceId` (string): Filter by device
- `q` (string): Search query
- `page` (number): Page number
- `pageSize` (number): Items per page
- `labelIds` (string): Comma-separated label IDs
- `sortBy` (string): Sort field
- `sortDir` (string): Sort direction (asc/desc)

#### POST `/contacts`
Create new contact.

**Request Body:**
```json
{
  "deviceId": "device-uuid",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "628123456789",
  "labels": ["customer", "vip"]
}
```

#### PUT `/contacts/:contactId`
Update contact.

#### DELETE `/contacts/:contactId`
Delete contact.

#### POST `/contacts/import`
Import contacts from file.

**Request Body:** `multipart/form-data`
- `file`: Excel/CSV file
- `deviceId`: Device ID

#### GET `/contacts/labels`
Get all contact labels.

#### GET `/contacts/count`
Get contact count.

#### POST `/contacts/sync-google`
Sync contacts with Google Contacts.

**Request Body:**
```json
{
  "accessToken": "google_oauth_access_token",
  "deviceId": "device-uuid"
}
```

> ⚠️ **Requires subscription plan with `isGoogleContactSync` enabled**

---

### Internal Groups (`/groups`)

> These are **internal contact groups** for organizing contacts, NOT WhatsApp groups.

#### POST `/groups`
Create internal group.

#### POST `/groups/add-members`
Add members to group.

#### POST `/groups/remove-members`
Remove members from group.

---

### WhatsApp Groups (`/wa-groups`)

#### GET `/wa-groups`
Get all WhatsApp groups.

**Query Parameters:**
- `deviceId` (string): Filter by device
- `search` (string): Search query
- `activeOnly` (boolean): Only active groups

#### GET `/wa-groups/:groupId`
Get single WhatsApp group.

#### POST `/wa-groups/sync`
Sync WhatsApp groups from device.

**Request Body:**
```json
{
  "deviceId": "device-uuid"
}
```

#### POST `/wa-groups/:groupId/activate`
Mark group as active.

#### POST `/wa-groups/:groupId/deactivate`
Mark group as inactive.

---

### Broadcasts (`/broadcasts`)

#### GET `/broadcasts`
Get all broadcasts.

**Query Parameters:**
- `deviceId` (string): Filter by device
- `status` (string): Filter by status
- `type` (string): Filter by type

#### GET `/broadcasts/:broadcastId`
Get broadcast details.

#### GET `/broadcasts/:broadcastId/recipients`
Get broadcast recipients.

#### GET `/broadcasts/:broadcastId/logs`
Get broadcast logs.

#### PATCH `/broadcasts/:broadcastId`
Update broadcast.

#### DELETE `/broadcasts/:broadcastId`
Delete broadcast.

#### DELETE `/broadcasts`
Delete multiple broadcasts.

---

### Code Snippets (`/snippets`)

#### GET `/snippets`
Get all user's snippets.

#### GET `/snippets/:id`
Get snippet by ID.

#### POST `/snippets`
Create new snippet.

**Request Body:**
```json
{
  "title": "My Snippet",
  "description": "Snippet description",
  "code": "console.log('Hello World');",
  "language": "javascript"
}
```

#### PUT `/snippets/:id`
Update snippet.

#### DELETE `/snippets/:id`
Delete snippet.

#### POST `/snippets/:id/regenerate-token`
Regenerate share token.

#### GET `/snippet/:shareToken` (Public)
View shared snippet.

---

### Device API (`/api`)

> All endpoints require device access token.

#### POST `/api/messages/send`
Send text message.

**Request Body:**
```json
{
  "to": "628123456789",
  "message": "Hello World!"
}
```

#### POST `/api/messages/send/image`
Send image message.

#### POST `/api/messages/send/doc`
Send document message.

#### POST `/api/messages/send/audio`
Send audio message.

#### POST `/api/messages/send/video`
Send video message.

#### POST `/api/messages/broadcasts`
Create broadcast.

#### POST `/api/messages/broadcasts/scheduled`
Create scheduled broadcast.

#### POST `/api/messages/broadcasts/feedback`
Create feedback broadcast.

#### POST `/api/messages/broadcasts/reminder-algo`
Create Algorithmics reminder broadcast.

#### POST `/api/monthly-feedback`
Send monthly feedback messages.

#### GET `/api/messages/get-profile`
Get WhatsApp profile picture.

#### GET `/api/messages/get-groups`
Get WhatsApp groups.

#### GET `/api/messages/conversation`
Get conversation messages.

#### GET `/api/messages/outgoing`
Get outgoing messages.

---

### Algorithmics (`/algorithmics`)

#### GET `/algorithmics/monthly-templates`
Get all monthly templates.

#### POST `/algorithmics/monthly-templates`
Create monthly template.

#### PUT `/algorithmics/monthly-templates/:id`
Update monthly template.

#### DELETE `/algorithmics/monthly-templates/:id`
Delete monthly template.

#### POST `/algorithmics/monthly-templates/import`
Import monthly templates.

---

### Course Feedback (`/course`)

#### GET `/course/feedbacks`
Get all course feedbacks.

#### GET `/course/feedback/:courseName`
Get feedback by course name.

#### POST `/course/feedback`
Create course feedback.

#### PUT `/course/feedback/:id`
Update course feedback.

#### DELETE `/course/feedback/:id`
Delete course feedback.

#### POST `/course/feedback/import`
Import course feedbacks.

---

## Error Responses

### Standard Error Format
```json
{
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

### Common HTTP Status Codes

| Status | Description |
|--------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Internal Server Error |

---

## Rate Limiting

API requests are rate limited based on subscription plan:
- Basic: 100 requests/minute
- Pro: 500 requests/minute
- Enterprise: Unlimited

---

## Changelog

### December 2025
- Added device health monitoring endpoints
- Added signal detector for device reliability
- Added WhatsApp group real-time sync
- Added code snippets feature
