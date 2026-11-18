import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireModule } from "@/lib/auth";
import { waConfigured, WA_TEMPLATE, WA_TEMPLATE_TEXT } from "@/lib/whatsapp";
import { WhatsAppTest } from "@/components/WhatsAppTest";

export default async function WhatsAppSettings() {
  const u = await requireModule("settings");
  const on = waConfigured();
  const [withNumber, total, sent, failed] = await Promise.all([
    prisma.user.count({ where: { active: true, whatsapp: { not: null }, whatsappOn: true } }),
    prisma.user.count({ where: { active: true } }),
    prisma.notification.count({ where: { whatsapp: "sent" } }),
    prisma.notification.count({ where: { whatsapp: "failed" } }),
  ]);
  return (
    <>
      <Link href="/settings" className="small muted">‹ Settings</Link>
      <h1 className="h1">WhatsApp connection</h1>
      <div className="card">
        <div className="row"><b className="grow">Office WhatsApp number</b><span className={`pill ${on ? "p-good" : "p-amber"}`}>{on ? "Connected" : "Not connected yet"}</span></div>
        <p className="hint">Every task, request and QC note in the app also goes to the person&apos;s WhatsApp, from one office number.</p>
        <div className="small">{withNumber} of {total} people have a WhatsApp number · {sent} sent · {failed} failed</div>
        {on && u.can("settings", "EDIT") && <WhatsAppTest />}
      </div>
      <div className="card">
        <b>How to connect (one time)</b>
        <ol className="alist">
          <li>Keep one SIM for the office that is <b>not</b> used in the WhatsApp app on any phone.</li>
          <li>Open <b>business.facebook.com</b> and use the company&apos;s Meta Business account (the one that runs the ads).</li>
          <li>Open <b>developers.facebook.com → My Apps → Create App → Business</b>, then add the product <b>WhatsApp</b>.</li>
          <li>In <b>WhatsApp → API Setup</b>, add the office number and confirm it with the SMS code. Note the <b>Phone number ID</b> shown there.</li>
          <li>In <b>WhatsApp Manager → Message templates</b>, create a template: name <code>{WA_TEMPLATE}</code>, category <b>Utility</b>, language <b>English</b>, body exactly:<br /><code>{WA_TEMPLATE_TEXT}</code><br />Sample for {"{{1}}"}: <i>Write script, Malaysia F 01, due 26 Nov</i>. Approval usually takes a few minutes to a day.</li>
          <li>In <b>Business settings → System users</b>, add a system user, give it the app and the WhatsApp account, and generate a <b>permanent token</b> with <code>whatsapp_business_messaging</code>.</li>
          <li>On the server, open the file <code>~/cma-office/.env</code> and add two lines: <code>WHATSAPP_TOKEN=…</code> and <code>WHATSAPP_PHONE_ID=…</code>. Then run <code>sh update.sh</code>. Do not send the token to anyone in chat.</li>
          <li>Come back to this page and press <b>Send a test to my WhatsApp</b>.</li>
        </ol>
        <p className="hint">Meta charges a small amount per message (utility rate for Bangladesh). Add a payment method in WhatsApp Manager.</p>
      </div>
    </>
  );
}
