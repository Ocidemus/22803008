# Notification System Design

## Stage 1

### Core Actions
1. **Send Notification** — Create and deliver a notification to a user
2. **Fetch Notifications** — Retrieve notifications for a logged-in user
3. **Mark as Read** — Mark one or more notifications as read
4. **Get Unread Count** — Get the count of unread notifications
5. **Real-time Push** — Push new notifications to connected clients in real-time

### REST API Endpoints

#### 1. GET /api/notifications
Fetch paginated notifications for the authenticated user.

**Request Headers:**
```json
{
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
}
```

**Query Parameters:**
| Parameter | Type    | Default | Description                                    |
|-----------|---------|---------|------------------------------------------------|
| page      | int     | 1       | Page number                                    |
| limit     | int     | 20      | Items per page                                 |
| type      | string  | null    | Filter by type: "Placement", "Result", "Event" |
| isRead    | boolean | null    | Filter by read status                          |

**Response (200):**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "Company XYZ hiring",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:18Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

#### 2. POST /api/notifications
Create and send a notification.

**Request Body:**
```json
{
  "type": "Placement",
  "message": "Company XYZ hiring",
  "recipientIds": ["student-uuid-1", "student-uuid-2"]
}
```

**Response (201):**
```json
{
  "id": "notification-uuid",
  "type": "Placement",
  "message": "Company XYZ hiring",
  "createdAt": "2026-04-22T17:51:18Z",
  "recipientCount": 2
}
```

---

#### 3. PATCH /api/notifications/:id/read
Mark a single notification as read.

**Response (200):**
```json
{
  "id": "notification-uuid",
  "isRead": true,
  "updatedAt": "2026-04-22T18:00:00Z"
}
```

---

#### 4. PATCH /api/notifications/read
Mark multiple notifications as read.

**Request Body:**
```json
{
  "notificationIds": ["uuid-1", "uuid-2"]
}
```

**Response (200):**
```json
{
  "updatedCount": 2
}
```

---

#### 5. GET /api/notifications/unread-count
Get unread notification count.

**Response (200):**
```json
{
  "count": 42
}
```

---

### Real-Time Notifications via SSE

Notifications only travel one way — server to client — so WebSockets are overkill here. SSE fits better: it's simpler, runs over plain HTTP/1.1 without a protocol upgrade, and browsers handle reconnection automatically.

**Endpoint:** `GET /api/notifications/stream`

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Format:**
```
event: notification
data: {"id":"uuid","type":"Placement","message":"Company XYZ hiring","createdAt":"2026-04-22T17:51:18Z"}
```

---

## Stage 2

### Storage: PostgreSQL

Notifications have clear structure — students, notification records, read status — and those relationships are well-suited to a relational model. PostgreSQL handles this cleanly: ACID guarantees mean a notification either gets saved or it doesn't, indexing keeps queries fast, and JSON columns cover any metadata that doesn't fit the fixed schema. PgBouncer handles connection pooling when load picks up.

### DB Schema

```sql
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('Placement', 'Result', 'Event')),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE student_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id),
    notification_id UUID NOT NULL REFERENCES notifications(id),
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_student_notifications_student_id ON student_notifications(student_id);
CREATE INDEX idx_student_notifications_unread ON student_notifications(student_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

### Scaling Considerations

1. **Slow reads on large tables** — A partial index on `is_read = FALSE` avoids scanning rows nobody queries anymore.
2. **Bulk insert spikes** — Batch inserts and PostgreSQL's `COPY` command handle high-volume notification sends without choking.
3. **Too many connections** — PgBouncer pools connections so the DB doesn't run out.
4. **Table bloat over time** — Partition `student_notifications` by month. Archive old read notifications periodically.
5. **Read-heavy traffic** — Read replicas take the load off the primary for GET queries.

### SQL Queries

**Fetch notifications (GET /api/notifications):**
```sql
SELECT n.id, n.type, n.message, sn.is_read, n.created_at
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = $1
ORDER BY n.created_at DESC
LIMIT $2 OFFSET $3;
```

**Create notification (POST /api/notifications):**
```sql
-- Insert notification
INSERT INTO notifications (type, message) VALUES ($1, $2) RETURNING id;

-- Bulk insert for recipients
INSERT INTO student_notifications (student_id, notification_id)
SELECT unnest($1::uuid[]), $2;
```

**Mark as read (PATCH):**
```sql
UPDATE student_notifications
SET is_read = TRUE, read_at = NOW()
WHERE student_id = $1 AND notification_id = $2 AND is_read = FALSE;
```

**Unread count:**
```sql
SELECT COUNT(*) FROM student_notifications
WHERE student_id = $1 AND is_read = FALSE;
```

---

## Stage 3

### Query Analysis

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Is this query correct?**
No. `studentID` and `isRead` don't live in the `notifications` table — they're in `student_notifications`. This query would either fail or return wrong results. It needs to join both tables.

**Why is it slow?**
With 50,000 students and 5,000,000 notifications:
- No index on `studentID` means a full table scan across 5M rows
- `SELECT *` pulls all columns including potentially large text fields
- `ORDER BY createdAt DESC` sorts the entire result without an index to help
- No `LIMIT` clause means potentially thousands of rows coming back

**What to fix:**
1. Rewrite against the correct table structure
2. Add a composite index
3. Add LIMIT/OFFSET for pagination

**Should you index every column?**
No. Indexes take disk space, and every write has to update every index. During a bulk send to 50,000 students, maintaining unnecessary indexes would hurt badly. Only index columns that actually appear in WHERE, JOIN, or ORDER BY clauses of frequent queries.

**Corrected query:**
```sql
SELECT n.id, n.type, n.message, n.created_at
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = 'student-uuid-1042'
  AND sn.is_read = FALSE
ORDER BY n.created_at DESC
LIMIT 20 OFFSET 0;
```

**Students who received a placement notification in the last 7 days:**
```sql
SELECT DISTINCT s.id, s.name, s.email
FROM students s
JOIN student_notifications sn ON s.id = sn.student_id
JOIN notifications n ON sn.notification_id = n.id
WHERE n.type = 'Placement'
  AND n.created_at >= NOW() - INTERVAL '7 days'
ORDER BY s.name;
```

---

## Stage 4

### The Performance Problem

Hitting the database on every page load doesn't scale. The same queries run repeatedly, the connection pool gets squeezed under concurrent users, and most of the time the data hasn't even changed.

### Solutions

#### Option 1: Redis Cache

Cache each student's unread notifications in Redis with a short TTL.

```
Key: notifications:unread:{student_id}
Value: JSON array of notifications
TTL: 60 seconds
```

Invalidate the key whenever a new notification arrives or one gets marked as read.

| | |
|---|---|
| **Pros** | Cuts DB reads dramatically (90%+), Redis responses are sub-millisecond |
| **Cons** | Needs Redis running, cache invalidation logic adds complexity, data can be up to 60s stale |

---

#### Option 2: Cursor-based Pagination

Skip fetching everything — only load the first page on open, then fetch more as needed.

```sql
SELECT n.id, n.type, n.message, n.created_at
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = $1 AND sn.is_read = FALSE
  AND n.created_at < $cursor
ORDER BY n.created_at DESC
LIMIT 20;
```

| | |
|---|---|
| **Pros** | Query time stays constant regardless of total notification count, no extra infrastructure |
| **Cons** | Still hits the DB on every page load, just with smaller payloads |

---

#### Option 3: SSE for Incremental Updates

Load the full list once. After that, keep an SSE connection open and push only new notifications as they arrive.

| | |
|---|---|
| **Pros** | No repeated DB queries after initial load, real-time updates, low server load once connected |
| **Cons** | Persistent connections consume memory per user, reconnection logic needed, first load still hits DB |

---

#### Recommended Combination

- **Redis** for the initial page load (Option 1)
- **SSE** for live updates after that (Option 3)
- **Cursor pagination** when users scroll further back (Option 2)

Fast first load, real-time feel, efficient deep history.

---

## Stage 5

### What's Wrong With This

```
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message)
        save_to_db(student_id, message)
        push_to_app(student_id, message)
```

**Problems:**

1. **Sequential processing** — 50,000 students at 100ms each = 83 minutes. That's not a notification system, that's a batch job.
2. **No error handling** — If email fails on student 200, the loop crashes. Students 201 through 50,000 hear nothing.
3. **Inconsistent state** — For failed students, it's unclear whether the DB write or push happened before the crash.
4. **Everything is coupled** — A slow email API blocks the DB write. A slow DB blocks the push. One bad dependency poisons everything.
5. **No retries** — A failed email is gone forever.
6. **No idempotency** — If the process restarts after a crash, students who already received the notification get it again.

### Should DB save and email happen together?

No. The DB write is fast and local. Email is slow and depends on an external API. Coupling them means a flaky email provider prevents the notification from being recorded at all — the student never sees it in-app either. Save to the DB first, then process email and push asynchronously.

### Redesigned Implementation

```
function notify_all(student_ids: array, message: string):
    // Save everything to DB first — fast, reliable, immediate in-app visibility
    notification_id = save_notification_to_db(message)
    batch_insert_student_notifications(student_ids, notification_id)

    // Queue async jobs for email and push in chunks
    for batch in chunk(student_ids, 500):
        queue.publish("email_channel", {
            notification_id,
            student_ids: batch,
            message
        })
        queue.publish("push_channel", {
            notification_id,
            student_ids: batch,
            message
        })

function email_worker(job):
    for student_id in job.student_ids:
        try:
            send_email(student_id, job.message)
            mark_email_sent(student_id, job.notification_id)
        catch error:
            retry_queue.publish(job, delay: exponential_backoff(attempt))
            log_failure(student_id, job.notification_id, error)

function push_worker(job):
    for student_id in job.student_ids:
        try:
            push_to_app(student_id, job.message)
        catch error:
            retry_queue.publish(job, delay: exponential_backoff(attempt))
```

**Key improvements:**
1. DB write happens first — in-app notifications are immediate
2. Email and push go through a message queue (RabbitMQ, Redis Streams, or SQS)
3. Jobs are chunked into 500s so external providers aren't overwhelmed
4. Email and push workers run independently — one failing doesn't affect the other
5. Exponential backoff handles retries automatically
6. `mark_email_sent` prevents duplicates if a job is retried
7. More workers can be added to speed up processing

---

## Stage 6

### Priority Inbox

**How priority is calculated:**
- Placement = 3, Result = 2, Event = 1
- Within the same type, newer notifications rank higher
- Score formula: `typeWeight * 1e10 + unixTimestamp`

This puts all Placements above all Results above all Events, with recency breaking ties within each group.

**Keeping the top-N list fresh as new notifications arrive:**

A min-heap of size N handles this efficiently:
1. Start with a min-heap capped at N entries, sorted by score
2. For each new notification:
   - If the heap has fewer than N items, insert it directly
   - If the new score beats the current minimum, swap it in
   - Otherwise, skip it
3. O(log N) per notification — no full re-sort needed

**For persistent storage**, a Redis Sorted Set works well:
```
ZADD priority_inbox:{student_id} <score> <notification_json>
ZREVRANGE priority_inbox:{student_id} 0 N-1
```

Inserts are O(log N), top-N retrieval is O(N).

See `priority_inbox/index.js` for the working implementation.