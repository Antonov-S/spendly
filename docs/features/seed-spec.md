# Seed Data Specification

## Overview

Create a seed script (`prisma/seed.ts`) to populate the database with sample data for development and demos. You can overwrite the current seed script if there is one. Reference @prisma/schema.prisma for the database structure. Also read @context/project-overview.md to see the data structure.

Do not make this too complex. It is only for displaying data in the dashboard like the screenshot. Do not create helper methods, just a simple data to import and populate the dashboard.

## Requirements

### Users

- **Email:** demo-nonpro@spendly.io
- **Name:** Demo User Free
- **Password:** 12345678 (hash with bcryptjs, 12 rounds)
- **isPro:** false
- **emailVerified:** current date

- **Email:** demo-pro@spendly.io
- **Name:** Demo User Pro
- **Password:** 12345678 (hash with bcryptjs, 12 rounds)
- **isPro:** true
- **emailVerified:** current date
