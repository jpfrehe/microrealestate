/* eslint-env node, mocha */
import {
  buildDatevBookings,
  classifyExpenseAccount,
  resolveCostCenter
} from '../../managers/datevexport.js';

const properties = [
  { _id: 'prop-1', name: 'Musterstrasse 12' },
  { _id: 'prop-2', name: 'Beispielweg 4' }
];

describe('classifyExpenseAccount', () => {
  it('returns the DATEV account for a known category', () => {
    expect(classifyExpenseAccount('maintenance')).toBe('4805');
    expect(classifyExpenseAccount('insurance')).toBe('4360');
  });

  it('returns null for an unknown or missing category', () => {
    expect(classifyExpenseAccount('not-a-real-category')).toBeNull();
    expect(classifyExpenseAccount(undefined)).toBeNull();
  });
});

describe('resolveCostCenter', () => {
  it('resolves the property name when exactly one property is given', () => {
    expect(resolveCostCenter(['prop-1'], properties)).toBe('Musterstrasse 12');
  });

  it('returns null when no property is given', () => {
    expect(resolveCostCenter([], properties)).toBeNull();
    expect(resolveCostCenter(undefined, properties)).toBeNull();
  });

  it('returns null when more than one property is given (ambiguous)', () => {
    expect(resolveCostCenter(['prop-1', 'prop-2'], properties)).toBeNull();
  });

  it('returns null when the property id does not exist', () => {
    expect(resolveCostCenter(['unknown-id'], properties)).toBeNull();
  });
});

describe('buildDatevBookings', () => {
  it('books a standard single-property rent payment as income (Haben)', () => {
    const { bookings, unclassified } = buildDatevBookings({
      payments: [
        {
          tenantName: 'Max Mustermann',
          propertyIds: ['prop-1'],
          amount: 950,
          date: new Date('2026-07-01T00:00:00Z'),
          reference: 'tx-1'
        }
      ],
      expenses: [],
      properties
    });

    expect(unclassified).toEqual([]);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      type: 'income',
      amount: 950,
      debitCredit: 'H',
      account: '8400',
      costCenter: 'Musterstrasse 12',
      documentReference: 'tx-1'
    });
  });

  it('books a standard single-property expense as an outflow (Soll)', () => {
    const { bookings, unclassified } = buildDatevBookings({
      payments: [],
      expenses: [
        {
          category: 'maintenance',
          propertyId: 'prop-1',
          amount: 250,
          date: new Date('2026-07-05T00:00:00Z'),
          description: 'Heizungswartung'
        }
      ],
      properties
    });

    expect(unclassified).toEqual([]);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      type: 'expense',
      amount: 250,
      debitCredit: 'S',
      account: '4805',
      costCenter: 'Musterstrasse 12',
      bookingText: 'Heizungswartung'
    });
  });

  it('flags a payment with no linked property as unclassified instead of guessing', () => {
    const { bookings, unclassified } = buildDatevBookings({
      payments: [
        {
          tenantName: 'Max Mustermann',
          propertyIds: [],
          amount: 950,
          date: new Date('2026-07-01T00:00:00Z')
        }
      ],
      expenses: [],
      properties
    });

    expect(bookings).toEqual([]);
    expect(unclassified).toHaveLength(1);
    expect(unclassified[0].reason).toMatch(/no property linked/);
  });

  it('flags a payment spanning multiple properties as unclassified rather than splitting it', () => {
    const { bookings, unclassified } = buildDatevBookings({
      payments: [
        {
          tenantName: 'Max Mustermann',
          propertyIds: ['prop-1', 'prop-2'],
          amount: 950,
          date: new Date('2026-07-01T00:00:00Z')
        }
      ],
      expenses: [],
      properties
    });

    expect(bookings).toEqual([]);
    expect(unclassified[0].reason).toMatch(/spans multiple properties/);
  });

  it('flags an expense with an unrecognized category as unclassified', () => {
    const { bookings, unclassified } = buildDatevBookings({
      payments: [],
      expenses: [
        {
          category: 'crypto_mining',
          propertyId: 'prop-1',
          amount: 100,
          date: new Date('2026-07-05T00:00:00Z')
        }
      ],
      properties
    });

    expect(bookings).toEqual([]);
    expect(unclassified).toHaveLength(1);
    expect(unclassified[0].account).toBe('9999');
    expect(unclassified[0].reason).toMatch(/unknown expense category/);
  });

  it('flags an expense with an unresolvable property as unclassified', () => {
    const { bookings, unclassified } = buildDatevBookings({
      payments: [],
      expenses: [
        {
          category: 'insurance',
          propertyId: 'does-not-exist',
          amount: 100,
          date: new Date('2026-07-05T00:00:00Z')
        }
      ],
      properties
    });

    expect(bookings).toEqual([]);
    expect(unclassified[0].reason).toMatch(/no property linked/);
  });

  it('takes the absolute amount, regardless of the sign stored on the expense', () => {
    const { bookings } = buildDatevBookings({
      payments: [],
      expenses: [
        {
          category: 'other',
          propertyId: 'prop-1',
          amount: -75.5,
          date: new Date('2026-07-05T00:00:00Z')
        }
      ],
      properties
    });

    expect(bookings[0].amount).toBe(75.5);
  });

  it('rounds amounts to 2 decimal places', () => {
    const { bookings } = buildDatevBookings({
      payments: [
        {
          tenantName: 'Max Mustermann',
          propertyIds: ['prop-1'],
          amount: 100.005,
          date: new Date('2026-07-01T00:00:00Z')
        }
      ],
      expenses: [],
      properties
    });

    expect(bookings[0].amount).toBe(100.01);
  });

  it('handles an empty period gracefully', () => {
    expect(
      buildDatevBookings({ payments: [], expenses: [], properties })
    ).toEqual({ bookings: [], unclassified: [] });
  });

  it('mixes classified and unclassified records from the same period correctly', () => {
    const { bookings, unclassified } = buildDatevBookings({
      payments: [
        {
          tenantName: 'Tenant A',
          propertyIds: ['prop-1'],
          amount: 950,
          date: new Date('2026-07-01T00:00:00Z')
        },
        {
          tenantName: 'Tenant B',
          propertyIds: [],
          amount: 600,
          date: new Date('2026-07-01T00:00:00Z')
        }
      ],
      expenses: [
        {
          category: 'insurance',
          propertyId: 'prop-2',
          amount: 80,
          date: new Date('2026-07-03T00:00:00Z')
        },
        {
          category: 'unknown_category',
          propertyId: 'prop-2',
          amount: 40,
          date: new Date('2026-07-03T00:00:00Z')
        }
      ],
      properties
    });

    expect(bookings).toHaveLength(2);
    expect(unclassified).toHaveLength(2);
  });
});
