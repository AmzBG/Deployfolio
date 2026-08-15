import { MailService } from './mail.service';

describe('MailService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('sends through Brevo using the configured sender and requested recipient', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'test-api-key';
    process.env.BREVO_SENDER_EMAIL = 'verified-sender@example.com';
    process.env.BREVO_SENDER_NAME = 'Deployfolio';

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    const service = new MailService();

    await expect(
      service.sendEmail({
        to: 'recipient@example.net',
        from: 'ignored-local-sender@example.org',
        subject: 'Verify your account',
        text: 'Verification text',
        html: '<p>Verification HTML</p>',
      }),
    ).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, request] = fetchSpy.mock.calls[0]!;
    expect(request?.headers).toMatchObject({
      'api-key': 'test-api-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(request?.body as string)).toEqual({
      sender: {
        email: 'verified-sender@example.com',
        name: 'Deployfolio',
      },
      to: [{ email: 'recipient@example.net' }],
      subject: 'Verify your account',
      textContent: 'Verification text',
      htmlContent: '<p>Verification HTML</p>',
    });
  });

  it('fails closed when production Brevo configuration is missing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_PROVIDER = 'brevo';
    delete process.env.BREVO_API_KEY;
    process.env.BREVO_SENDER_EMAIL = 'verified-sender@example.com';

    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new MailService();

    await expect(
      service.sendEmail({
        to: 'recipient@example.net',
        from: 'ignored-local-sender@example.org',
        subject: 'Verify your account',
        text: 'Verification text',
      }),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
