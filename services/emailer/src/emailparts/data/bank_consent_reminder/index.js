import { Collections } from '@microrealestate/common';
import moment from 'moment';

// recordId is a BankAccount id (landlord-facing reminder, not tenant-facing)
export async function get(bankAccountId /*, params*/) {
  const dbBankAccount = await Collections.BankAccount.findOne({
    _id: bankAccountId
  }).populate('realmId');
  if (!dbBankAccount) {
    throw new Error('bank account not found');
  }

  const bankAccount = dbBankAccount.toObject();
  const landlord = bankAccount.realmId;
  landlord.name =
    (landlord.isCompany
      ? landlord.companyInfo?.name
      : landlord.contacts?.[0]?.name) || '';
  landlord.hasContact = !!landlord.contacts?.length;
  landlord.hasAddress = !!landlord.addresses?.length;

  // data that will be injected in the email content files (ejs files)
  return {
    landlord,
    bankAccount: {
      bankName: bankAccount.bankName,
      iban: bankAccount.iban,
      status: bankAccount.status,
      consentExpiryDate: moment(bankAccount.consentExpiryDate).format(
        'DD/MM/YYYY'
      )
    },
    today: moment().format('DD/MM/YYYY')
  };
}
