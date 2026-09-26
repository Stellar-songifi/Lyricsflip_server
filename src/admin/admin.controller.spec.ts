import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/roles/role.enum';

describe('AdminController', () => {
  let controller: AdminController;
  let service: AdminService;

  const mockAdminService = {
    findAllUsers: jest.fn().mockResolvedValue({
      data: [{ id: '1', email: 'user@test.com' }],
      meta: { total: 1, page: 1, limit: 5 },
    }),
    deleteUser: jest.fn().mockResolvedValue({ message: 'User deleted' }),
    findInactiveLyrics: jest.fn().mockResolvedValue({
      data: [{ id: 'lyric-1', title: 'Removed lyric', isActive: false }],
      meta: { total: 1, page: 1, limit: 5 },
    }),
    restoreLyric: jest.fn().mockResolvedValue({ id: 'lyric-1', title: 'Removed lyric', isActive: true }),
  };

  // Mock user payloads for testing
  const adminUser = { userId: 'admin-id', roles: [Role.Admin] };
  const regularUser = { userId: 'user-id', roles: [Role.User] };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
      ],
    })

      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          const req = context.switchToHttp().getRequest();
          req.user = req.headers.userrole === 'admin' ? adminUser : regularUser;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (context) => {
          const req = context.switchToHttp().getRequest();
          return req.user.roles.includes(Role.Admin);
        },
      })
      .compile();

    controller = module.get<AdminController>(AdminController);
    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /admin/users', () => {
    it('should allow an admin to find all users', async () => {
      const result = await controller.findAllUsers({ page: 1, limit: 5 });
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 5 });
      expect(mockAdminService.findAllUsers).toHaveBeenCalledWith({ page: 1, limit: 5 });
    });

    it('should pass sorting options through to the service', async () => {
      await controller.findAllUsers({ page: 2, limit: 10, sortBy: 'email', sortOrder: 'DESC' });
      expect(mockAdminService.findAllUsers).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        sortBy: 'email',
        sortOrder: 'DESC',
      });
    });
  });

  describe('DELETE /admin/users/:id', () => {
    it('should allow an admin to delete a user', async () => {
      const userId = 'some-uuid';
      await controller.deleteUser(userId);
      expect(mockAdminService.deleteUser).toHaveBeenCalledWith(userId);
    });
  });

  describe('GET /admin/lyrics?status=inactive', () => {
    it('should allow an admin to list deactivated lyrics', async () => {
      const result = await controller.findInactiveLyrics({ page: 1, limit: 5 });
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 5 });
      expect(mockAdminService.findInactiveLyrics).toHaveBeenCalledWith({ page: 1, limit: 5 });
    });
  });

  describe('POST /admin/lyrics/:id/restore', () => {
    it('should allow an admin to restore a deactivated lyric', async () => {
      const lyricId = 'lyric-1';
      const result = await controller.restoreLyric(lyricId);
      expect(result).toBeDefined();
      expect(result.isActive).toBe(true);
      expect(mockAdminService.restoreLyric).toHaveBeenCalledWith(lyricId);
    });
  });
});
