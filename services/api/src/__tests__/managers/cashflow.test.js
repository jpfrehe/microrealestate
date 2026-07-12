/* eslint-env node, mocha */
import { computeCashflow } from '../../managers/cashflow.js';

const JULY_START = 2026070100;
const JULY_END = 2026073123;
const JUNE = 2026060100;

function rent(term, { grandTotal, balance = 0, payment }) {
  return { term, total: { grandTotal, balance, payment } };
}

describe('computeCashflow', () => {
  it('attributes a single-property tenant income and due amount to that property', () => {
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Musterstrasse 12' }],
      tenants: [
        {
          properties: [{ propertyId: 'prop-1', rent: 950 }],
          rents: [rent(JULY_START, { grandTotal: 950, payment: 950 })]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.properties).toHaveLength(1);
    expect(result.properties[0]).toMatchObject({
      propertyId: 'prop-1',
      dueAmount: 950,
      income: 950,
      expenses: 0,
      cashflow: 950,
      arrears: 0
    });
  });

  it('subtracts expenses from income to compute cashflow', () => {
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Musterstrasse 12' }],
      tenants: [
        {
          properties: [{ propertyId: 'prop-1', rent: 950 }],
          rents: [rent(JULY_START, { grandTotal: 950, payment: 950 })]
        }
      ],
      expenses: [
        { propertyId: 'prop-1', amount: 200 },
        { propertyId: 'prop-1', amount: 50 }
      ],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.properties[0]).toMatchObject({
      income: 950,
      expenses: 250,
      cashflow: 700
    });
  });

  it('reports arrears when the due amount exceeds what was actually paid', () => {
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Musterstrasse 12' }],
      tenants: [
        {
          properties: [{ propertyId: 'prop-1', rent: 950 }],
          rents: [rent(JULY_START, { grandTotal: 950, payment: 400 })]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.properties[0]).toMatchObject({
      dueAmount: 950,
      income: 400,
      arrears: 550
    });
  });

  it('excludes a carried-forward balance from the due amount of the current term', () => {
    // grandTotal already includes 300 of arrears carried over from a prior
    // month - the "due amount" for *this* term should exclude that.
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Musterstrasse 12' }],
      tenants: [
        {
          properties: [{ propertyId: 'prop-1', rent: 950 }],
          rents: [
            rent(JULY_START, { grandTotal: 1250, balance: 300, payment: 0 })
          ]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.properties[0].dueAmount).toBe(950);
  });

  it('allocates a multi-property tenant proportionally to each property rent share', () => {
    const result = computeCashflow({
      properties: [
        { _id: 'prop-1', name: 'Wohnung A' },
        { _id: 'prop-2', name: 'Garage' }
      ],
      tenants: [
        {
          properties: [
            { propertyId: 'prop-1', rent: 800 },
            { propertyId: 'prop-2', rent: 200 }
          ],
          rents: [rent(JULY_START, { grandTotal: 1000, payment: 1000 })]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    const wohnung = result.properties.find((p) => p.propertyId === 'prop-1');
    const garage = result.properties.find((p) => p.propertyId === 'prop-2');
    expect(wohnung.income).toBe(800); // 80% share
    expect(garage.income).toBe(200); // 20% share
  });

  it('splits evenly across properties when no property has a rent share', () => {
    const result = computeCashflow({
      properties: [
        { _id: 'prop-1', name: 'A' },
        { _id: 'prop-2', name: 'B' }
      ],
      tenants: [
        {
          properties: [
            { propertyId: 'prop-1', rent: 0 },
            { propertyId: 'prop-2', rent: 0 }
          ],
          rents: [rent(JULY_START, { grandTotal: 500, payment: 500 })]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(
      result.properties.find((p) => p.propertyId === 'prop-1').income
    ).toBe(250);
    expect(
      result.properties.find((p) => p.propertyId === 'prop-2').income
    ).toBe(250);
  });

  it('shows a purely negative cashflow for a vacant property with only expenses', () => {
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Leerstand' }],
      tenants: [],
      expenses: [{ propertyId: 'prop-1', amount: 120 }],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.properties[0]).toMatchObject({
      income: 0,
      expenses: 120,
      cashflow: -120,
      arrears: 0 // nothing was due since there is no tenant
    });
  });

  it('ignores rents outside the requested term range', () => {
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Musterstrasse 12' }],
      tenants: [
        {
          properties: [{ propertyId: 'prop-1', rent: 950 }],
          rents: [
            rent(JUNE, { grandTotal: 950, payment: 950 }),
            rent(JULY_START, { grandTotal: 950, payment: 950 })
          ]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    // only the July rent should be counted, not June's
    expect(result.properties[0].income).toBe(950);
  });

  it('aggregates all properties into a portfolio total', () => {
    const result = computeCashflow({
      properties: [
        { _id: 'prop-1', name: 'A' },
        { _id: 'prop-2', name: 'B' }
      ],
      tenants: [
        {
          properties: [{ propertyId: 'prop-1', rent: 900 }],
          rents: [rent(JULY_START, { grandTotal: 900, payment: 900 })]
        },
        {
          properties: [{ propertyId: 'prop-2', rent: 600 }],
          rents: [rent(JULY_START, { grandTotal: 600, payment: 300 })]
        }
      ],
      expenses: [{ propertyId: 'prop-1', amount: 100 }],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.portfolio).toMatchObject({
      dueAmount: 1500,
      income: 1200,
      expenses: 100,
      cashflow: 1100,
      arrears: 300
    });
  });

  it('returns the 5 properties with the highest arrears, sorted descending', () => {
    const properties = Array.from({ length: 7 }, (_, i) => ({
      _id: `prop-${i}`,
      name: `Property ${i}`
    }));
    const tenants = properties.map((property, i) => ({
      properties: [{ propertyId: property._id, rent: 100 }],
      // arrears increase with i: prop-0 has the least, prop-6 the most
      rents: [rent(JULY_START, { grandTotal: 100, payment: 100 - i * 10 })]
    }));

    const result = computeCashflow({
      properties,
      tenants,
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.topArrears).toHaveLength(5);
    expect(result.topArrears[0].propertyId).toBe('prop-6'); // largest arrears first
    expect(result.topArrears.map((p) => p.arrears)).toEqual(
      [...result.topArrears.map((p) => p.arrears)].sort((a, b) => b - a)
    );
  });

  it('excludes fully paid properties from topArrears', () => {
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Musterstrasse 12' }],
      tenants: [
        {
          properties: [{ propertyId: 'prop-1', rent: 950 }],
          rents: [rent(JULY_START, { grandTotal: 950, payment: 950 })]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.topArrears).toEqual([]);
  });

  it('handles an empty portfolio (no properties, no tenants)', () => {
    const result = computeCashflow({
      properties: [],
      tenants: [],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.properties).toEqual([]);
    expect(result.portfolio).toMatchObject({
      dueAmount: 0,
      income: 0,
      expenses: 0,
      cashflow: 0,
      arrears: 0
    });
    expect(result.topArrears).toEqual([]);
  });

  it('handles a tenant with no properties assigned (defensive)', () => {
    const result = computeCashflow({
      properties: [{ _id: 'prop-1', name: 'Musterstrasse 12' }],
      tenants: [
        {
          properties: [],
          rents: [rent(JULY_START, { grandTotal: 950, payment: 950 })]
        }
      ],
      expenses: [],
      startTerm: JULY_START,
      endTerm: JULY_END
    });

    expect(result.properties[0]).toMatchObject({ income: 0, dueAmount: 0 });
  });
});
