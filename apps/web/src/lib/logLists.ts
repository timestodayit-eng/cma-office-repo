// The Log Sheet columns (same order, widths and header colours as the Google Sheet)
// and the dropdown lists of its hidden "Input" tab.
import { LOG_STATUSES, PRIORITIES, MAIN_CATEGORIES, CONTENT_TYPES } from "@cma/core";
import type { LogCol } from "./sheetRules";

const AGENCIES = ["Creative International", "Coastal Manpower", "SM Enterprise"];
const PAGES = ["Creative International", "Creative International BD", "Coastal Manpower BD", "Coastal Manpower", "SM Enterprise", "SM Enterprise BD"];
const EDITORS = ["Mahadi", "Dipu", "Nadim", "Toukir", "Ismail", "Zahid", "Mamun"];

export type LogColDef = { key: LogCol; label: string; width: number; kind: "text" | "list" | "link"; list?: readonly string[]; color: string };

export const LOG_COL_DEFS: LogColDef[] = [
  { key: "title", label: "Content Title", width: 230, kind: "text", color: "#6FA8DC" },
  { key: "deadline", label: "Deadline", width: 92, kind: "text", color: "#3C78D8" },
  { key: "priority", label: "Work Priority", width: 100, kind: "list", list: PRIORITIES, color: "#EB82B6" },
  { key: "company", label: "Company Name", width: 150, kind: "list", list: AGENCIES, color: "#9FC5E8" },
  { key: "mainCategory", label: "Main Category", width: 160, kind: "list", list: MAIN_CATEGORIES, color: "#A4D3DA" },
  { key: "contentType", label: "Content Type", width: 104, kind: "list", list: CONTENT_TYPES, color: "#93C47D" },
  { key: "scriptWriter", label: "Script Writter", width: 100, kind: "list", list: ["Solaiman", "Kabbo", "Atik", "Rajon", "Sohel"], color: "#FFE599" },
  { key: "scriptLink", label: "Script Link", width: 84, kind: "link", color: "#F1C232" },
  { key: "presenter", label: "Presenter", width: 90, kind: "list", list: ["Atik", "Kabbo", "MD Sir"], color: "#CC0000" },
  { key: "cinematographer", label: "Cinematographer", width: 118, kind: "list", list: ["Rakib", "Rajon", "Sadi ( CM )", "Emon ( CI )", "Towhid ( SM )"], color: "#93C47D" },
  { key: "videoEditor", label: "Video Editor", width: 100, kind: "list", list: EDITORS, color: "#D5A6BD" },
  { key: "status", label: "Status", width: 128, kind: "list", list: LOG_STATUSES, color: "#A64D79" },
  { key: "thumbnail", label: "Thumbnail", width: 96, kind: "list", list: EDITORS, color: "#3D85C6" },
  { key: "rawFile", label: "Raw File", width: 84, kind: "link", color: "#CC0000" },
  { key: "finalOutput", label: "Final Output", width: 104, kind: "link", color: "#9FC5E8" },
  { key: "comments", label: "Comments", width: 170, kind: "text", color: "#EA9999" },
  { key: "uploadFacebook", label: "Upload: Facebook", width: 150, kind: "list", list: PAGES, color: "#666666" },
  { key: "uploadYoutube", label: "Upload: YouTube", width: 150, kind: "list", list: AGENCIES, color: "#A64D79" },
  { key: "uploadTiktok", label: "Upload: TikTok", width: 150, kind: "list", list: AGENCIES, color: "#A64D79" },
  { key: "platformFacebook", label: "Platform: Facebook", width: 150, kind: "list", list: PAGES, color: "#A64D79" },
  { key: "platformYoutube", label: "Platform: YouTube", width: 150, kind: "list", list: AGENCIES, color: "#A64D79" },
  { key: "platformTiktok", label: "Platform: TikTok", width: 150, kind: "list", list: AGENCIES, color: "#D5A6BD" },
  { key: "finalComments", label: "Final Comments", width: 170, kind: "text", color: "#351C75" },
];

/** Whole-row colour by Status, as in the sheet: [background, text]. */
export const ROW_COLOR: Record<string, [string, string]> = {
  Uploaded: ["#6AA84F", "#fff"],
  Dropped: ["#45818E", "#fff"],
  "Shooting Done": ["#1155CC", "#fff"],
  "On Edit": ["#FBBC04", "#000"],
  "For Upload": ["#351C75", "#fff"],
  Cancelled: ["#d9ead3", "#1c2733"],
  Reserved: ["#d9ead3", "#1c2733"],
};

/** Dark text on light header colours, white on dark ones. */
export function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? "#1c2733" : "#fff";
}
