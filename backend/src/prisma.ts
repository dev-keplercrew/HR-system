// Single shared PrismaClient instance for the whole backend.
// Every route/service imports THIS — never construct a new PrismaClient elsewhere.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
