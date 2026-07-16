import mongoose from 'mongoose';
import { ServiceError } from '@microrealestate/common';

// Route ids reach Mongo straight from the URL, so they are coerced to a
// primitive and shape-checked before a query is built from them - the same
// treatment the body-supplied ids already get in loanmanager.ts. Beyond
// keeping user input out of the query operators, this is what turns a
// malformed id into the 404 the contract promises: Mongo would otherwise
// answer a CastError, which surfaces as a 500.
export function readObjectIdParam(value: unknown): string {
  const id = String(value ?? '');
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ServiceError('id is not a valid identifier', 404);
  }
  return id;
}
