import { GameGateway } from './game.gateway';

describe('GameGateway authentication', () => {
  const jwt = { verifyAsync: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('secret') };
  const gateway = new GameGateway({} as any, jwt as any, config as any);
  const makeClient = (auth: any = {}, headers: any = {}) =>
    ({
      id: 'sock1',
      data: {},
      handshake: { auth, headers },
      emit: jest.fn(),
      disconnect: jest.fn(),
    }) as any;

  beforeEach(() => jest.clearAllMocks());

  it('rejects connections without a token', async () => {
    const client = makeClient();
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects connections with an invalid token', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('bad'));
    const client = makeClient({ token: 'x' });
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('accepts a valid token and attributes the session to the user', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    const client = makeClient({}, { authorization: 'Bearer good' });
    await gateway.handleConnection(client);
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.data.userId).toBe('user-1');
    gateway.handleDisconnect(client);
  });
});
