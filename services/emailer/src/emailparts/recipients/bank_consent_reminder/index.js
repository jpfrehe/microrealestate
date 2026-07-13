export function get(bankAccountId, params, data) {
  let emailDeliveryServiceConfig;
  if (data.landlord.thirdParties?.gmail?.selected) {
    emailDeliveryServiceConfig = data.landlord.thirdParties.gmail;
  }
  if (data.landlord.thirdParties?.smtp?.selected) {
    emailDeliveryServiceConfig = data.landlord.thirdParties.smtp;
  }
  if (data.landlord.thirdParties?.mailgun?.selected) {
    emailDeliveryServiceConfig = data.landlord.thirdParties.mailgun;
  }

  if (!emailDeliveryServiceConfig) {
    throw new Error('landlord has not configured an email delivery service');
  }

  const fromEmail = emailDeliveryServiceConfig.fromEmail;
  const replyToEmail = emailDeliveryServiceConfig.replyToEmail;

  const recipientsList = (data.landlord.members || [])
    .filter(({ registered, email }) => registered && email)
    .reduce((acc, { email }) => {
      if (acc.find(({ to }) => to === email.toLowerCase())) {
        return acc;
      }
      acc.push({
        from: fromEmail,
        to: email.toLowerCase(),
        replyTo: replyToEmail
      });
      return acc;
    }, []);

  if (!recipientsList.length) {
    throw new Error('realm has no registered member with an email address');
  }

  return recipientsList;
}
