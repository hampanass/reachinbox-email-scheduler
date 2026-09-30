import "dotenv/config";
import nodemailer, { type Transporter } from "nodemailer";

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

let transporterPromise: Promise<Transporter> | undefined;
let senderAddress: string | undefined;

async function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      let user = process.env.ETHEREAL_USER;
      let pass = process.env.ETHEREAL_PASSWORD;

      if (!user || !pass) {
        const account = await nodemailer.createTestAccount();
        user = account.user;
        pass = account.pass;
        senderAddress = account.user;
        console.info(`Created Ethereal test account for ${user}`);
      }

      return nodemailer.createTransport({
        host: process.env.ETHEREAL_HOST ?? "smtp.ethereal.email",
        port: Number(process.env.ETHEREAL_PORT ?? 587),
        secure: Number(process.env.ETHEREAL_PORT ?? 587) === 465,
        auth: { user, pass },
      });
    })();
  }

  return transporterPromise;
}

export async function sendEmail(message: EmailMessage): Promise<string | undefined> {
  const transport = await getTransporter();
  const result = await transport.sendMail({
    from: process.env.ETHEREAL_USER ?? senderAddress ?? "scheduler@reachinbox.test",
    to: message.to,
    subject: message.subject,
    text: message.text,
  });

  return nodemailer.getTestMessageUrl(result) || undefined;
}