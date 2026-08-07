import 'dotenv/config';
import { createHash } from 'crypto';
import { extname } from 'path';
import { prisma } from '../../src/client';
import { SeedObjectStorage } from '../seeders/seedObjectStorage';

type MigrationCandidate = {
  label: string;
  sourceUrl: string;
  targetKey: string;
  persist: (publicUrl: string) => Promise<boolean>;
};

const LEGACY_UPLOAD_PREFIX = '/uploads/';

async function main() {
  const apply = process.argv.includes('--apply');
  const sourceBaseUrl = optionalValue(process.env.LEGACY_MEDIA_BASE_URL);
  const downloadAttempts = positiveInteger(
    process.env.LEGACY_MEDIA_DOWNLOAD_ATTEMPTS,
    30,
  );
  const candidates = await collectCandidates(sourceBaseUrl);

  console.log(
    `${apply ? 'Applying' : 'Dry run:'} ${candidates.length} legacy media migration(s).`,
  );

  if (!apply) {
    for (const candidate of candidates) {
      console.log(
        `  ${candidate.label}: ${candidate.sourceUrl} -> ${candidate.targetKey}`,
      );
    }
    console.log('No files or database rows were changed. Re-run with --apply.');
    return;
  }

  if (candidates.length === 0) return;

  const objectStorage = new SeedObjectStorage();
  await objectStorage.assertAvailable();

  const failures: Array<{ label: string; error: unknown }> = [];
  let migrated = 0;

  // Keep this deliberately sequential. It avoids saturating the old API task
  // and makes a production run easy to follow and safely rerun.
  for (const candidate of candidates) {
    try {
      const publicUrl = await objectStorage.mirrorImage(
        candidate.sourceUrl,
        candidate.targetKey,
        {
          attempts: downloadAttempts,
          sourceFingerprint: createHash('sha256')
            .update(candidate.sourceUrl)
            .digest('hex'),
        },
      );
      const persisted = await candidate.persist(publicUrl);
      if (!persisted) {
        console.log(
          `  Skipped ${candidate.label}; its database URL changed during the migration.`,
        );
        continue;
      }
      migrated += 1;
      console.log(`  Migrated ${candidate.label}.`);
    } catch (error) {
      failures.push({ label: candidate.label, error });
      console.error(`  Failed ${candidate.label}: ${errorMessage(error)}`);
    }
  }

  console.log(
    `Migration finished: ${migrated} succeeded, ${failures.length} failed.`,
  );

  if (failures.length > 0) {
    throw new Error(
      'Some media could not be migrated. Their database URLs were left unchanged; fix the source and rerun the command.',
    );
  }
}

async function collectCandidates(
  sourceBaseUrl: string | undefined,
): Promise<MigrationCandidate[]> {
  const [profiles, projects, media] = await Promise.all([
    prisma.developerProfile.findMany({
      select: {
        id: true,
        profilePictureUrl: true,
        profilePictureOriginalUrl: true,
      },
    }),
    prisma.project.findMany({
      select: { id: true, logoUrl: true },
    }),
    prisma.projectMedia.findMany({
      select: { id: true, publicUrl: true },
    }),
  ]);

  const candidates: MigrationCandidate[] = [];

  for (const profile of profiles) {
    const cropped = legacySource(profile.profilePictureUrl, sourceBaseUrl);
    if (cropped) {
      const previousUrl = profile.profilePictureUrl!;
      candidates.push({
        label: `developer profile ${profile.id} cropped picture`,
        sourceUrl: cropped.url,
        targetKey: `migrated/profile-pictures/${profile.id}/cropped${cropped.extension}`,
        persist: async (profilePictureUrl) => {
          const result = await prisma.developerProfile.updateMany({
            where: { id: profile.id, profilePictureUrl: previousUrl },
            data: { profilePictureUrl },
          });
          return result.count === 1;
        },
      });
    }

    const original = legacySource(
      profile.profilePictureOriginalUrl,
      sourceBaseUrl,
    );
    if (original) {
      const previousUrl = profile.profilePictureOriginalUrl!;
      candidates.push({
        label: `developer profile ${profile.id} original picture`,
        sourceUrl: original.url,
        targetKey: `migrated/profile-pictures/${profile.id}/original${original.extension}`,
        persist: async (profilePictureOriginalUrl) => {
          const result = await prisma.developerProfile.updateMany({
            where: {
              id: profile.id,
              profilePictureOriginalUrl: previousUrl,
            },
            data: { profilePictureOriginalUrl },
          });
          return result.count === 1;
        },
      });
    }
  }

  for (const project of projects) {
    const logo = legacySource(project.logoUrl, sourceBaseUrl);
    if (!logo) continue;
    const previousUrl = project.logoUrl!;

    candidates.push({
      label: `project ${project.id} logo`,
      sourceUrl: logo.url,
      targetKey: `migrated/project-logos/${project.id}/logo${logo.extension}`,
      persist: async (logoUrl) => {
        const result = await prisma.project.updateMany({
          where: { id: project.id, logoUrl: previousUrl },
          data: { logoUrl },
        });
        return result.count === 1;
      },
    });
  }

  for (const item of media) {
    const source = legacySource(item.publicUrl, sourceBaseUrl);
    if (!source) continue;
    const previousUrl = item.publicUrl;

    const storageKey = `migrated/project-media/${item.id}/media${source.extension}`;
    candidates.push({
      label: `project media ${item.id}`,
      sourceUrl: source.url,
      targetKey: storageKey,
      persist: async (publicUrl) => {
        const result = await prisma.projectMedia.updateMany({
          where: { id: item.id, publicUrl: previousUrl },
          data: { storageKey, publicUrl },
        });
        return result.count === 1;
      },
    });
  }

  return candidates;
}

function legacySource(
  value: string | null,
  sourceBaseUrl: string | undefined,
): { url: string; extension: string } | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalized, sourceBaseUrl);
  } catch {
    throw new Error(
      `Cannot resolve legacy media URL "${normalized}". Set LEGACY_MEDIA_BASE_URL to the currently running API origin.`,
    );
  }

  if (!parsed.pathname.startsWith(LEGACY_UPLOAD_PREFIX)) return null;

  if (sourceBaseUrl) {
    const sourceBase = new URL(sourceBaseUrl);
    parsed = new URL(`${parsed.pathname}${parsed.search}`, sourceBase);
  }

  return {
    url: parsed.toString(),
    extension: safeImageExtension(parsed.pathname),
  };
}

function safeImageExtension(pathname: string): string {
  const extension = extname(pathname).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)
    ? extension
    : '';
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main()
  .catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
