// Seeds companies, the real team roster, company roles and default settings.
// Phone numbers are placeholders (01700-0000xx) until Jamil enters the real ones.
// Everyone starts with password "cma12345" and should change it after first login.
// Runs only on an empty database (pass --force to re-apply on a dev machine).
import { PrismaClient, Level } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultModuleAccess, DEFAULT_TIMELINE, MODULES } from "@cma/core";

const prisma = new PrismaClient();

const COMPANIES = [
  { short: "CI", name: "Creative International", hotlines: ["80", "50"], sortOrder: 1 },
  { short: "CM", name: "Coastal Manpower", hotlines: ["11", "22"], sortOrder: 2 },
  { short: "SM", name: "SM Enterprise", hotlines: ["84", "94"], sortOrder: 3 },
];

type Seed = {
  key: string;
  name: string;
  level: Level;
  department: string;
  designation: string;
  external?: boolean;
  resp?: string[];
};

const PEOPLE: Seed[] = [
  { key: "khalid", name: "Khalid Saifullah", level: "SUPER_ADMIN", department: "Team Lead", designation: "CEO & Managing Editor", resp: ["command", "assign", "attendance", "payroll", "finance", "recruitment"] },
  { key: "jamil", name: "Md Jamil Ahammed", level: "SUPER_ADMIN", department: "Digital Marketing", designation: "Executive, HR, Admin, Accounts", resp: ["command", "assign", "attendance", "payroll", "finance", "recruitment", "broadcast_officer", "ads"] },
  { key: "ariful", name: "Ariful Islam", level: "STAFF", department: "Digital Marketing", designation: "Senior Executive", resp: ["ads", "marketing_report"] },
  { key: "jisan", name: "Jisan Sazib", level: "STAFF", department: "Digital Marketing", designation: "Senior Executive", resp: ["ads"] },
  { key: "mustakim", name: "MD Mustakim Billah", level: "STAFF", department: "Digital Marketing", designation: "Executive", resp: ["broadcast_officer", "uploader"] },
  { key: "solaiman", name: "Solaiman Rafi", level: "MANAGER", department: "Creative", designation: "Creative Lead & Content Writer", resp: ["creative_lead", "qc", "assign", "command"] },
  { key: "sohel", name: "Sohel Ariyan", level: "MANAGER", department: "Creative", designation: "Content Director", resp: ["content_director"] },
  { key: "atik", name: "Atik Mahmud", level: "STAFF", department: "Creative", designation: "Content Creator (CM)", resp: ["writer", "model"] },
  { key: "mosahead", name: "Mosahead Hasan", level: "STAFF", department: "Creative", designation: "Content Creator (CI)", resp: ["writer", "model"] },
  { key: "kabbo", name: "Abdullah Nayeem Kabbo", level: "STAFF", department: "Creative", designation: "Content Creator (SM)", resp: ["writer", "model"] },
  { key: "rajon", name: "Rajon", level: "STAFF", department: "Creative", designation: "Content Writer", resp: ["writer"] },
  { key: "mahdi", name: "Mahdi Hassan Gifari", level: "STAFF", department: "Production", designation: "Video Editor", resp: ["editor"] },
  { key: "dipu", name: "MD Dipu", level: "STAFF", department: "Production", designation: "Video Editor", resp: ["editor"] },
  { key: "toukir", name: "Toukir", level: "STAFF", department: "Production", designation: "Video Editor", resp: ["editor"] },
  { key: "zahid", name: "Zahid Hasan Antor", level: "STAFF", department: "Production", designation: "Video Editor", resp: ["editor"] },
  { key: "ismail", name: "Ismail Jamil", level: "STAFF", department: "Production", designation: "Video Editor", resp: ["editor"] },
  { key: "nadim", name: "Nadim Ahmed", level: "STAFF", department: "Production", designation: "Video Editor", resp: ["editor"] },
  { key: "rakib", name: "Rakib Hossain Hridoy", level: "STAFF", department: "Production", designation: "Cinematographer", resp: ["cinematographer"] },
  { key: "zubayer", name: "Zubayer", level: "STAFF", department: "Support partner", designation: "Logsheet & IT", external: true },
];

/** company short -> role -> person keys (placeholders where Jamil has not confirmed). */
const COMPANY_ROLES: Record<string, Record<string, string[]>> = {
  CI: { writer: ["mosahead"], model: ["mosahead"], editor: ["mahdi", "toukir"], qc: ["solaiman"], ads: ["ariful"], broadcast_officer: ["jamil"], uploader: ["mustakim"] },
  CM: { writer: ["atik"], model: ["atik"], editor: ["zahid", "ismail"], qc: ["solaiman"], ads: ["ariful"], broadcast_officer: ["mustakim"], uploader: ["mustakim"] },
  SM: { writer: ["kabbo"], model: ["kabbo"], editor: ["dipu", "nadim"], qc: ["solaiman"], ads: ["ariful"], broadcast_officer: ["mustakim"], uploader: ["mustakim"] },
};
const GLOBAL_ROLES: Record<string, string[]> = {
  creative_lead: ["solaiman"],
  content_director: ["sohel"],
  cinematographer: ["rakib"],
};

async function main() {
  // Only seed an empty database, so admin changes are never undone on restart.
  if ((await prisma.user.count()) > 0 && !process.argv.includes("--force")) {
    console.log("Users already exist; seed skipped (use --force to re-apply).");
    return;
  }
  const passwordHash = await bcrypt.hash("cma12345", 10);

  const companies: Record<string, string> = {};
  for (const c of COMPANIES) {
    const row = await prisma.company.upsert({ where: { short: c.short }, update: c, create: c });
    companies[c.short] = row.id;
  }

  const users: Record<string, string> = {};
  let i = 1;
  for (const p of PEOPLE) {
    const phone = `017000000${String(i++).padStart(2, "0")}`;
    const u = await prisma.user.upsert({
      where: { phone },
      update: { name: p.name, level: p.level, department: p.department, designation: p.designation, external: !!p.external },
      create: {
        name: p.name,
        shortName: p.name.split(" ").find((w) => !/^(md|mr)$/i.test(w)) ?? p.name,
        phone,
        whatsapp: phone,
        passwordHash,
        level: p.level,
        department: p.department,
        designation: p.designation,
        external: !!p.external,
      },
    });
    users[p.key] = u.id;
    const access = defaultModuleAccess(p.level);
    if (p.resp?.some((r) => ["ads", "marketing_report", "broadcast_officer", "recruitment", "finance"].includes(r))) {
      access.recruitment = "EDIT";
      access.broadcast = "EDIT";
      access.marketing = "EDIT";
    }
    for (const m of MODULES) {
      await prisma.modulePermission.upsert({
        where: { userId_module: { userId: u.id, module: m.key } },
        update: {},
        create: { userId: u.id, module: m.key, access: access[m.key] },
      });
    }
    for (const r of p.resp ?? []) {
      await prisma.responsibility.upsert({
        where: { userId_key: { userId: u.id, key: r } },
        update: {},
        create: { userId: u.id, key: r, companies: [], contentTypes: [] },
      });
    }
  }

  await prisma.companyRole.deleteMany({});
  for (const [short, roles] of Object.entries(COMPANY_ROLES)) {
    for (const [role, keys] of Object.entries(roles)) {
      for (const k of keys) {
        await prisma.companyRole.create({ data: { companyId: companies[short], role, userId: users[k] } });
      }
    }
  }
  for (const [role, keys] of Object.entries(GLOBAL_ROLES)) {
    for (const k of keys) await prisma.companyRole.create({ data: { companyId: null, role, userId: users[k] } });
  }

  await prisma.setting.upsert({
    where: { key: "timeline" },
    update: {},
    create: { key: "timeline", value: { ...DEFAULT_TIMELINE } },
  });
  await prisma.setting.upsert({
    where: { key: "financial" },
    update: {},
    create: { key: "financial", value: { planningRateBdt: 129.5 } },
  });

  console.log(`Seeded ${COMPANIES.length} companies, ${PEOPLE.length} users.`);
}

main().finally(() => prisma.$disconnect());
