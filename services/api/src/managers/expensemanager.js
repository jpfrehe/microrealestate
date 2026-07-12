import { Collections } from '@microrealestate/common';

////////////////////////////////////////////////////////////////////////////////
// Exported functions
////////////////////////////////////////////////////////////////////////////////
export async function add(req, res) {
  const realm = req.realm;
  const expense = new Collections.Expense({
    ...req.body,
    realmId: realm._id,
    source: 'manual'
  });
  await expense.save();
  return res.json(expense.toObject());
}

export async function update(req, res) {
  const realm = req.realm;
  const expense = req.body;

  const dbExpense = await Collections.Expense.findOneAndUpdate(
    {
      realmId: realm._id,
      _id: expense._id
    },
    { ...expense, updatedDate: new Date() },
    { new: true }
  ).lean();

  if (!dbExpense) {
    return res.sendStatus(404);
  }

  return res.json(dbExpense);
}

export async function remove(req, res) {
  const realm = req.realm;
  const ids = req.params.ids.split(',');

  await Collections.Expense.deleteMany({
    _id: { $in: ids },
    realmId: realm._id
  });

  res.sendStatus(200); // better to return 204
}

export async function all(req, res) {
  const realm = req.realm;
  const filter = { realmId: realm._id };
  if (req.query.propertyId) {
    filter.propertyId = req.query.propertyId;
  }

  const dbExpenses = await Collections.Expense.find(filter)
    .sort({ date: -1 })
    .lean();

  return res.json(dbExpenses);
}

export async function one(req, res) {
  const realm = req.realm;

  const dbExpense = await Collections.Expense.findOne({
    _id: req.params.id,
    realmId: realm._id
  }).lean();

  if (!dbExpense) {
    return res.sendStatus(404);
  }

  return res.json(dbExpense);
}
