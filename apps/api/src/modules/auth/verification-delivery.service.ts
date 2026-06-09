import { createHmac, randomUUID } from "node:crypto";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

type AccountKind = "email" | "phone";
export type VerificationDelivery = "console" | "email" | "sms";

type VerificationDeliveryInput = {
  account: string;
  kind: AccountKind;
  code: string;
  ttlSeconds: number;
  purpose: string;
};

@Injectable()
export class VerificationDeliveryService {
  private readonly logger = new Logger(VerificationDeliveryService.name);

  async sendVerificationCode(input: VerificationDeliveryInput): Promise<VerificationDelivery> {
    if (!this.shouldUseRealDelivery()) {
      this.logger.log(
        `Verification code for ${this.maskAccount(input.account)} (${input.purpose}): ${input.code}`
      );
      return "console";
    }

    if (input.kind === "email") {
      await this.sendEmail(input);
      return "email";
    }

    await this.sendSms(input);
    return "sms";
  }

  private shouldUseRealDelivery() {
    if (process.env.VERIFICATION_DELIVERY_MODE === "console") {
      return process.env.NODE_ENV === "production";
    }
    if (process.env.VERIFICATION_DELIVERY_MODE === "real") {
      return true;
    }
    return process.env.NODE_ENV === "production";
  }

  private async sendEmail(input: VerificationDeliveryInput) {
    const host = this.requiredEnv("SMTP_HOST");
    const user = this.requiredEnv("SMTP_USER");
    const pass = this.requiredEnv("SMTP_PASS");
    const from = this.requiredEnv("MAIL_FROM");
    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure = this.booleanEnv("SMTP_SECURE", port === 465);

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to: input.account,
        subject: "AI Creator Platform verification code",
        text: this.emailText(input),
        html: this.emailHtml(input),
      });
    } catch (error) {
      this.logger.warn(`Email verification delivery failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException("email verification delivery failed");
    }
  }

  private async sendSms(input: VerificationDeliveryInput) {
    const accessKeyId = this.requiredEnv("ALIYUN_ACCESS_KEY_ID");
    const accessKeySecret = this.requiredEnv("ALIYUN_ACCESS_KEY_SECRET");
    const signName = this.requiredEnv("ALIYUN_SMS_SIGN_NAME");
    const templateCode = this.requiredEnv("ALIYUN_SMS_TEMPLATE_CODE");
    const endpoint = process.env.ALIYUN_SMS_ENDPOINT ?? "https://dysmsapi.aliyuncs.com/";
    const regionId = process.env.ALIYUN_SMS_REGION_ID ?? "cn-hangzhou";
    const codeParamName = process.env.ALIYUN_SMS_CODE_PARAM_NAME ?? "code";

    const params: Record<string, string> = {
      AccessKeyId: accessKeyId,
      Action: "SendSms",
      Format: "JSON",
      PhoneNumbers: input.account,
      RegionId: regionId,
      SignName: signName,
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: randomUUID(),
      SignatureVersion: "1.0",
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ [codeParamName]: input.code }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      Version: "2017-05-25",
    };

    const body = this.toFormBody({
      ...params,
      Signature: this.signAliyunRpc(params, accessKeySecret),
    });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.Code !== "OK") {
        const code = typeof payload.Code === "string" ? payload.Code : `HTTP_${response.status}`;
        const message = typeof payload.Message === "string" ? payload.Message : "unknown error";
        throw new Error(`${code}: ${message}`);
      }
    } catch (error) {
      this.logger.warn(`SMS verification delivery failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException("sms verification delivery failed");
    }
  }

  private signAliyunRpc(params: Record<string, string>, accessKeySecret: string) {
    const canonicalizedQueryString = Object.keys(params)
      .sort()
      .map((key) => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`)
      .join("&");
    const stringToSign = `POST&%2F&${this.percentEncode(canonicalizedQueryString)}`;
    return createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
  }

  private toFormBody(params: Record<string, string>) {
    return Object.keys(params)
      .map((key) => `${this.percentEncode(key)}=${this.percentEncode(params[key])}`)
      .join("&");
  }

  private percentEncode(value: string) {
    return encodeURIComponent(value)
      .replace(/\+/g, "%20")
      .replace(/\*/g, "%2A")
      .replace(/%7E/g, "~");
  }

  private emailText(input: VerificationDeliveryInput) {
    return [
      `Your verification code is ${input.code}.`,
      `It expires in ${Math.floor(input.ttlSeconds / 60)} minutes.`,
      "If you did not request this code, you can ignore this email.",
    ].join("\n");
  }

  private emailHtml(input: VerificationDeliveryInput) {
    const minutes = Math.floor(input.ttlSeconds / 60);
    return [
      "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827\">",
      "<p>Your verification code is:</p>",
      `<p style=\"font-size:28px;font-weight:700;letter-spacing:4px\">${input.code}</p>`,
      `<p>This code expires in ${minutes} minutes.</p>`,
      "<p>If you did not request this code, you can ignore this email.</p>",
      "</div>",
    ].join("");
  }

  private requiredEnv(name: string) {
    const value = process.env[name]?.trim();
    if (value) return value;
    throw new ServiceUnavailableException(`${name} is required for verification delivery`);
  }

  private booleanEnv(name: string, fallback: boolean) {
    const value = process.env[name]?.trim().toLowerCase();
    if (!value) return fallback;
    return value === "1" || value === "true" || value === "yes";
  }

  private maskAccount(account: string) {
    if (account.includes("@")) {
      const [name, domain] = account.split("@");
      return name && domain ? `${name.slice(0, 2)}***@${domain}` : account;
    }
    return account.length <= 4 ? account : `${account.slice(0, 3)}***${account.slice(-2)}`;
  }
}
