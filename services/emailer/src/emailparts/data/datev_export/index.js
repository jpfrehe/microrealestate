import { Collections } from '@microrealestate/common';
import moment from 'moment';

// recordId is a Realm id (landlord-facing export, not tenant-facing)
export async function get(realmId, params) {
  const dbRealm = await Collections.Realm.findOne({ _id: realmId });
  if (!dbRealm) {
    throw new Error('realm not found');
  }

  const landlord = dbRealm.toObject();
  landlord.name =
    (landlord.isCompany
      ? landlord.companyInfo?.name
      : landlord.contacts?.[0]?.name) || '';
  landlord.hasContact = !!landlord.contacts?.length;
  landlord.hasAddress = !!landlord.addresses?.length;

  // data that will be injected in the email content files (ejs files)
  return {
    landlord,
    period: moment(`${params.month}/${params.year}`, 'MM/YYYY').format(
      'MMMM YYYY'
    ),
    today: moment().format('DD/MM/YYYY')
  };
}
