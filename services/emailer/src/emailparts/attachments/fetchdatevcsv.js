import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Service } from '@microrealestate/common';

// year/month ultimately originate from the :year/:month segments of the
// landlord-facing /accounting/:year/:month/datev/send URL - reject anything
// that isn't a plain 4-digit year / 1-2 digit month before it reaches the
// outbound request URL or the on-disk file path (path traversal / SSRF).
function parseYearMonth(params) {
  const year = Number(params.year);
  const month = Number(params.month);
  if (
    !/^\d{4}$/.test(String(params.year)) ||
    !/^\d{1,2}$/.test(String(params.month)) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error(`invalid year/month: ${params.year}/${params.month}`);
  }
  return { year, month };
}

// Mirrors fetchpdf.js's fetch-on-demand pattern: the attachment bytes are
// never passed through the emailer's request body/params, they're fetched
// straight from the api service's existing GET /accounting/:year/:month/
// datev route using the same authorization the landlord used to trigger
// the send.
export default function (
  authorizationHeader,
  organizationId,
  recordId,
  params,
  filename
) {
  const { year, month } = parseYearMonth(params);
  const { API_URL, TEMPORARY_DIRECTORY } =
    Service.getInstance().envConfig.getValues();
  const uri = `${API_URL}/accounting/${year}/${month}/datev`;
  const fileDir = path.join(TEMPORARY_DIRECTORY, 'datev_export');
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir);
  }
  const filePath = path.join(fileDir, path.basename(filename));
  const wStream = fs.createWriteStream(filePath);

  return axios
    .get(uri, {
      responseType: 'stream',
      headers: {
        authorization: authorizationHeader,
        organizationid: organizationId
      }
    })
    .then((response) => {
      return new Promise((resolve, reject) => {
        let isErrorOccured = false;
        wStream.on('error', (error) => {
          isErrorOccured = true;
          wStream.close();
          reject(error);
        });
        wStream.on('close', () => {
          if (!isErrorOccured) {
            resolve(filePath);
          }
          //no need to call the reject here, already done in the 'error' stream;
        });
        response.data.pipe(wStream);
      });
    });
}
