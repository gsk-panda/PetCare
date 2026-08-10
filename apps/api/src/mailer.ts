import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/**
 * Mail goes out through SES when SES_FROM names a verified sender. With no
 * sender configured the message is logged instead, which is what a developer
 * wants and what a production deployment must never be left in -- see
 * mailerConfigured(), which the portal uses to decide whether it may hand the
 * login code back in the response.
 */
const FROM = process.env.SES_FROM;
const client = FROM ? new SESv2Client({ region: process.env.AWS_REGION ?? 'us-east-1' }) : null;

export function mailerConfigured(): boolean {
  return client !== null;
}

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(mail: Mail, log: (msg: string, meta?: unknown) => void): Promise<void> {
  if (!client || !FROM) {
    // Recipient only. The subject carries the login code, and an unsent
    // message is no reason to write one into the log stream.
    log('mailer not configured; message not sent', { to: mail.to });
    return;
  }
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [mail.to] },
      Content: {
        Simple: {
          Subject: { Data: mail.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: mail.text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}

/**
 * The code is the whole message. No links, nothing to click: a login email
 * that trains customers to click links is a phishing lesson delivered by the
 * facility they trust.
 */
export function loginCodeMail(to: string, code: string, facilityName: string): Mail {
  return {
    to,
    subject: `${code} is your ${facilityName} sign-in code`,
    text: [
      `Your sign-in code is ${code}.`,
      '',
      'It expires in 10 minutes and can be used once.',
      `If you did not ask to sign in to ${facilityName}, you can ignore this email.`,
    ].join('\n'),
  };
}
