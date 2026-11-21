# Notifications

Persistent, per-user notifications with optional live delivery.

## Overview

Notifications are stored in the database via TypeORM (`Notification` entity) and
served through `NotificationsService`. When a realtime gateway is available,
new notifications are also pushed to the recipient's `user:<id>` room so the
client receives them without polling.

## Module wiring

`NotificationsModule` registers the repository with
`TypeOrmModule.forFeature([Notification])` so `NotificationsService` can inject
`@InjectRepository(Notification)`.

Live delivery goes through the small `RealtimePublisher` abstraction, which is
backed by `RealtimeGateway` and its `user:<id>` channel. If no publisher is
provided, notifications are still persisted and simply not pushed live.

`EventEmitterModule.forRoot()` is configured once in `AppModule`; the
notifications module does not set it up itself.

## API

- `GET /notifications/me` — paginated list of the current user's notifications,
  returned in the shared pagination envelope (`data` + `meta`).
- `PATCH /notifications/:id/read` — mark a single notification as read.
- `POST /notifications/read-all` — mark all of the current user's notifications
  as read.
- `DELETE /notifications/me` — delete the current user's notifications only.

There is no global `DELETE /notifications`; deletion is always scoped to the
authenticated user. Expired notifications are removed by the existing retention
purge.

## Delivery flow

1. A domain event (e.g. a level-up) calls `NotificationsService.create(...)`.
2. The notification is persisted for the target user.
3. `RealtimePublisher` emits it to the `user:<id>` room.
4. Clients fetch history through `GET /notifications/me` and receive new items
   live.
