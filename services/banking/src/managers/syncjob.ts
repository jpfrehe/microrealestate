import { BankAccountDoc, syncBankAccount } from './bankaccountmanager.js';
import { Collections, logger, Service } from '@microrealestate/common';
import axios from 'axios';
import { needsConsentReminder } from './bankaccountlogic.js';

// UC1 Phase 2: "Geplanter Sync-Job (z. B. täglicher Cron)" - periodically
// re-syncs every connected account and, once a consent is expiring soon or
// already requires re-authorization, sends the landlord a reminder email
// via the emailer service (at most once per account, see
// bankaccountlogic.needsConsentReminder). Wired up as a setInterval in
// index.ts rather than a real cron dependency, matching this codebase's
// otherwise dependency-light style.
async function sendConsentReminderEmail(
  bankAccount: BankAccountDoc
): Promise<void> {
  const { EMAILER_URL } = Service.getInstance().envConfig.getValues();
  if (!EMAILER_URL) {
    throw new Error('EMAILER_URL is not configured');
  }
  const realmId = String(bankAccount.realmId);
  const accessToken = await Service.getInstance().createServiceToken(
    'administrator',
    realmId
  );

  await axios.post(
    EMAILER_URL,
    {
      templateName: 'bank_consent_reminder',
      recordId: String(bankAccount._id),
      params: {}
    },
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        organizationid: realmId
      }
    }
  );
}

export async function runScheduledSync(): Promise<void> {
  const bankAccounts = await Collections.BankAccount.find({
    status: { $in: ['connected', 'reauth_required'] }
  });

  for (const bankAccount of bankAccounts) {
    try {
      if (bankAccount.status === 'connected') {
        await syncBankAccount(bankAccount);
      }

      if (needsConsentReminder(bankAccount)) {
        await sendConsentReminderEmail(bankAccount);
        bankAccount.reauthReminderSentDate = new Date();
        await bankAccount.save();
      }
    } catch (error) {
      logger.error(
        `banking scheduled sync failed for bank account ${bankAccount._id}: ${String(error)}`
      );
    }
  }
}
