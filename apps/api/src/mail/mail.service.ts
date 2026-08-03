import { Injectable, Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { MailpitClient } from 'mailpit-api';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private mailpit: MailpitClient | null = null;
  private ses: SESv2Client | null = null;
  private sesFromEmail: string | null = null;
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor() {
    // Only initialize Mailpit in non-production environments
    if (!this.isProduction && process.env.MAILPIT_URL) {
      this.mailpit = new MailpitClient(process.env.MAILPIT_URL);
      this.logger.log(
        `Mailpit client initialized with URL: ${process.env.MAILPIT_URL}`,
      );
    } else if (this.isProduction && process.env.SES_FROM_EMAIL) {
      this.ses = new SESv2Client({
        region: process.env.AWS_REGION ?? 'us-west-2',
      });
      this.sesFromEmail = process.env.SES_FROM_EMAIL;
      this.logger.log('Amazon SES client initialized');
    } else if (this.isProduction) {
      this.logger.error(
        'SES_FROM_EMAIL is not set. Production email functionality is disabled.',
      );
    } else {
      this.logger.warn(
        'MAILPIT_URL environment variable not set. Email functionality disabled.',
      );
    }
  }

  async sendEmail(params: {
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<boolean> {
    try {
      if (this.mailpit && !this.isProduction) {
        await this.mailpit.sendMessage({
          To: [{ Email: params.to }],
          From: { Email: params.from || 'no-reply@bootcamp-starter.local' },
          Subject: params.subject,
          Text: params.text || '',
          HTML: params.html || '',
        });
      } else if (this.ses && this.sesFromEmail) {
        await this.ses.send(
          new SendEmailCommand({
            FromEmailAddress: this.sesFromEmail,
            Destination: {
              ToAddresses: [params.to],
            },
            Content: {
              Simple: {
                Subject: {
                  Data: params.subject,
                  Charset: 'UTF-8',
                },
                Body: {
                  ...(params.text
                    ? {
                        Text: {
                          Data: params.text,
                          Charset: 'UTF-8',
                        },
                      }
                    : {}),
                  ...(params.html
                    ? {
                        Html: {
                          Data: params.html,
                          Charset: 'UTF-8',
                        },
                      }
                    : {}),
                },
              },
            },
          }),
        );
      } else {
        this.logger.error('No email provider is configured');
        return false;
      }

      this.logger.log(`Email sent successfully: ${params.subject}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${params.to}:`, error);
      return false;
    }
  }
}
