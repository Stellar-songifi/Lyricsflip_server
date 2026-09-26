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
    findAllUsers: jest
      .fn()
      .mockResolvedValue([{ id: '1', email: 'user@test.com' }]),
    deleteUser: jest.fn().mockResolvedValue({ message: 'User deleted' }),
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
      const result = await controller.findAllUsers({ limit: 5, offset: 10 });
      expect(result).toBeDefined();
      expect(mockAdminService.findAllUsers).toHaveBeenCalledWith(5, 10);
    });
  });

  describe('DELETE /admin/users/:id', () => {
    it('should allow an admin to delete a user', async () => {
      const userId = 'some-uuid';
      await controller.deleteUser(userId);
      expect(mockAdminService.deleteUser).toHaveBeenCalledWith(userId);
    });
  });
});
