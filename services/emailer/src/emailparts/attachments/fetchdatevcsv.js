import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Service } from '@microrealestate/common';

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
  const { API_URL, TEMPORARY_DIRECTORY } =
    Service.getInstance().envConfig.getValues();
  const uri = `${API_URL}/accounting/${params.year}/${params.month}/datev`;
  const fileDir = path.join(TEMPORARY_DIRECTORY, 'datev_export');
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir);
  }
  const filePath = path.join(fileDir, filename);
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
