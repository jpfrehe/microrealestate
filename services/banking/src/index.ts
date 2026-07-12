import * as Express from 'express';
import { EnvironmentConfig, logger, Service } from '@microrealestate/common';
import routes from './routes.js';

Main();

async function onStartUp(application: Express.Application) {
  application.use(routes());
}

async function Main() {
  let service;
  try {
    service = Service.getInstance(
      new EnvironmentConfig({
        DEMO_MODE: process.env.DEMO_MODE
          ? process.env.DEMO_MODE.toLowerCase() === 'true'
          : undefined
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
