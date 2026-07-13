import * as Express from 'express';
import { EnvironmentConfig, logger, Service } from '@microrealestate/common';
import routes from './routes.js';
import { runScheduledSync } from './managers/syncjob.js';

Main();

const DEFAULT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily, per UC1 Phase 2

async function onStartUp(application: Express.Application) {
  application.use(routes());

  const intervalMs = Number(
    process.env.BANKING_SYNC_INTERVAL_MS || DEFAULT_SYNC_INTERVAL_MS
  );
  setInterval(() => {
    runScheduledSync().catch((error) => logger.error(String(error)));
  }, intervalMs);
}

async function Main() {
  let service;
  try {
    service = Service.getInstance(
      new EnvironmentConfig({
        DEMO_MODE: process.env.DEMO_MODE
          ? process.env.DEMO_MODE.toLowerCase() === 'true'
          : undefined,
        LANDLORD_APP_URL:
          process.env.LANDLORD_APP_URL || 'http://localhost:8080/landlord',
        API_URL: process.env.API_URL || 'http://api:8200/api/v2',
        EMAILER_URL: process.env.EMAILER_URL || 'http://localhost:8083/emailer'
      })
    );

    await service.init({
      name: 'banking',
      useRequestParsers: true,
      useMongo: true,
      useAxios: true,
      onStartUp
    });

    await service.startUp();
  } catch (error) {
    logger.error(String(error));
    service?.shutDown(-1);
  }
}
