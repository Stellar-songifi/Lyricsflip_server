import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should have a redirectToHealth method', () => {
      // The root GET / now redirects to /health/live via @Redirect().
      // The handler itself returns void; the redirect is handled by NestJS.
      expect(typeof appController.redirectToHealth).toBe('function');
    });
  });
});
