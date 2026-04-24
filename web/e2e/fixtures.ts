import ExcelJS from "exceljs/dist/exceljs.js";

export const FIXED_DATETIME = "2026-04-24 00:32:53";

export const APP_ONLY_RAW_CSV = [
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
  "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,,,America/Chicago",
  "study,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,,,America/Chicago",
].join("\n");

export const APP_AND_SCREEN_RAW_CSV = [
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
  "study,P01,Android,Target Child,System,Unknown importance: 15,android,2026-03-07 10:00:00,,,America/Chicago",
  "study,P01,Android,Target Child,Filtered Reader,Unknown importance: 1,com.example.filtered,2026-03-07 10:00:05,,,America/Chicago",
  "study,P01,Android,Target Child,Filtered Reader,Unknown importance: 2,com.example.filtered,2026-03-07 10:00:15,,,America/Chicago",
  "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:20,,,America/Chicago",
  "study,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:20,,,America/Chicago",
  "study,P01,Android,Target Child,System,Unknown importance: 16,android,2026-03-07 10:01:40,,,America/Chicago",
].join("\n");

export const MIXED_TIMEZONE_RAW_CSV = [
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
  "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,2026-03-07 10:00:00,,,America/Chicago",
  "study,P01,Android,Target Child,Chat,Unknown importance: 2,com.example.chat,2026-03-07 10:01:00,,,America/Chicago",
  "study,P01,Android,Target Child,Maps,Unknown importance: 1,com.example.maps,2026-03-07 11:00:00,,,America/New_York",
  "study,P01,Android,Target Child,Maps,Unknown importance: 2,com.example.maps,2026-03-07 11:01:00,,,America/New_York",
].join("\n");

export const MULTI_FILE_RAW_CSV_A = APP_ONLY_RAW_CSV;

export const MULTI_FILE_RAW_CSV_B = [
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
  "study,P02,Android,Target Child,Maps,Unknown importance: 1,com.example.maps,2026-03-08 09:00:00,,,America/Chicago",
  "study,P02,Android,Target Child,Maps,Unknown importance: 2,com.example.maps,2026-03-08 09:05:00,,,America/Chicago",
].join("\n");

export const MALFORMED_RAW_CSV = [
  "study_id,participant_id,possible_device_model,username,application_label,interaction_type,app_package_name,event_timestamp,start_timestamp,stop_timestamp,timezone",
  "study,P01,Android,Target Child,Chat,Unknown importance: 1,com.example.chat,not-a-timestamp,,,America/Chicago",
].join("\n");

export const FILTER_FILE_CSV = [
  "app_package_name,known_application_labels",
  "com.example.filtered,Filtered Reader",
].join("\n");

export const KEEP_AWAKE_CSV = [
  "package_name,label_or_note",
  "com.example.chat,Chat",
].join("\n");

export const CODEBOOK_CSV = [
  "app_package_name,application_label,play_store_genreId,play_store_broad_app_category,play_store_free",
  "com.example.chat,Chat,SOCIAL,Social,true",
  "com.example.filtered,Filtered Reader,BOOKS_AND_REFERENCE,Reading,true",
  "com.example.maps,Maps,TRAVEL_AND_LOCAL,Navigation,true",
].join("\n");

export async function createFilterWorkbookBytes(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Filter");
  worksheet.addRow(["app_package_name", "known_application_labels"]);
  worksheet.addRow(["com.example.filtered", "Filtered Reader"]);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
