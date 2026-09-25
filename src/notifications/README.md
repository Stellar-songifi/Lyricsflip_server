# Notifications Module

A mock notification system for LyricFlip using NestJS Event Emitters to simulate in-app notification behavior.

## Features

- **Event-driven notifications** using `@nestjs/event-emitter`
- **Mock event emission** for testing and development
- **In-memory storage** of notifications (no database required)
- **Multiple notification types**:
  - Level up notifications
  - Challenge completion notifications
  - Achievement notifications
- **Comprehensive test coverage** with Jest
- **Swagger API documentation**

## Notification Types

### 1. Level Up Notifications
- **Event**: `user.leveled_up`
- **Message**: `🎉 You leveled up to [Title]!`
- **Payload**: Includes new level, title, and XP gained

### 2. Challenge Completed Notifications
- **Event**: `user.completed_challenge`
- **Message**: `🔥 You completed [Challenge] with [Count] correct guesses in a row!`
- **Payload**: Includes challenge name, streak count, and optional reward

### 3. Achievement Notifications
- **Event**: `user.achievement_unlocked`
- **Types**:
  - `perfect_guess` - 🎯 Perfect guess!
  - `streak` - 🔥 Streak achieved!
  - `first_win` - 🏆 First win!
  - `speed_demon` - ⚡ Speed demon!

## API Endpoints

All endpoints except `GET /notifications/me` are admin-only. The test, custom
and `generate-mock-data` endpoints are not registered when `NODE_ENV=production`.

### Test Endpoints (Quick Testing)
- `POST /notifications/test/level-up` - Emit test level up notification
- `POST /notifications/test/challenge` - Emit test challenge notification
- `POST /notifications/test/achievement` - Emit test achievement notification

### Custom Notification Endpoints
- `POST /notifications/mock-level-up` - Emit custom level up notification
- `POST /notifications/mock-challenge-completed` - Emit custom challenge notification
- `POST /notifications/mock-achievement` - Emit custom achievement notification

### Data Management Endpoints
- `POST /notifications/generate-mock-data` - Generate sample notifications
- `GET /notifications/me` - Get your own notifications
- `GET /notifications/user/:userId` - Get notifications for specific user
- `DELETE /notifications` - Clear all stored notifications

## Usage Examples

### Emitting a Level Up Notification
```typescript
// In your service
constructor(private notificationsService: NotificationsService) {}

// Emit level up event
this.notificationsService.emitLevelUpEvent({
  userId: 'user-123',
  newLevel: 5,
  newTitle: 'Gossip Queen',
  xpGained: 100,
});
```

### Emitting a Challenge Notification
```typescript
this.notificationsService.emitChallengeCompletedEvent({
  userId: 'user-123',
  challengeName: 'Perfect Streak',
  streakCount: 5,
  reward: '50 tokens',
});
```

### Emitting an Achievement Notification
```typescript
this.notificationsService.emitAchievementEvent({
  userId: 'user-123',
  achievementType: 'perfect_guess',
  achievementValue: 10,
  reward: 'Speed boost',
});
```

## Event Handling

The service automatically handles incoming events and stores them in memory:

```typescript
@OnEvent('user.leveled_up')
handleLevelUpEvent(payload: LevelUpNotificationPayload): void {
  this.logger.log(`🎉 Level up notification: ${payload.message}`);
  this.storeNotification(payload);
}
```

## Testing

Run the test suite:
```bash
npm test src/notifications
```

The module includes comprehensive tests for:
- Event emission
- Event handling
- Data storage and retrieval
- Controller endpoints

## Future Enhancements

This mock implementation provides a foundation for:
- **Real-time notifications** via WebSockets
- **Database persistence** for notification history
- **Push notifications** for mobile devices
- **Email notifications** for important events
- **Notification preferences** and user settings

## Integration with Other Modules

The notifications module can be easily integrated with other game modules:

```typescript
// In game service
constructor(private notificationsService: NotificationsService) {}

// When user levels up
onUserLevelUp(userId: string, newLevel: number, newTitle: string) {
  // Update user level in database
  // ...
  
  // Emit notification
  this.notificationsService.emitLevelUpEvent({
    userId,
    newLevel,
    newTitle,
    xpGained: 100,
  });
}
``` 