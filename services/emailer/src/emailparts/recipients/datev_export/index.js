export function get(realmId, params, data) {
  if (!data.landlord.taxAdvisorEmail) {
    throw new Error('no tax advisor email configured for this realm');
  }

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

  return [
    {
      from: emailDeliveryServiceConfig.fromEmail,
      to: data.landlord.taxAdvisorEmail.toLowerCase(),
      replyTo: emailDeliveryServiceConfig.replyToEmail
    }
  ];
}
