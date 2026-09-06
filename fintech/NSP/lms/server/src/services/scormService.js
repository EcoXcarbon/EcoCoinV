import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import path from 'path';
import fs from 'fs';

/* ═══════════════════════════════════════════════════════════
   GAP 4: SCORM SERVICE
   Parse SCORM 1.2/2004 packages and extract metadata
   ═══════════════════════════════════════════════════════════ */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
});

/**
 * Parse a SCORM package ZIP buffer.
 * Extracts imsmanifest.xml, determines SCORM version, and returns metadata.
 *
 * @param {Buffer} zipBuffer - The uploaded ZIP file buffer
 * @param {String} moduleId - The module ID for storage path
 * @param {String} uploadDir - Base uploads directory
 * @returns {{ title, version, launchFile, organization, metadata }}
 */
export function parseScormPackage(zipBuffer, moduleId, uploadDir) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Find imsmanifest.xml
  const manifestEntry = entries.find(e =>
    e.entryName.toLowerCase() === 'imsmanifest.xml' ||
    e.entryName.toLowerCase().endsWith('/imsmanifest.xml')
  );

  if (!manifestEntry) {
    throw new Error('Invalid SCORM package: imsmanifest.xml not found');
  }

  const manifestXml = manifestEntry.getData().toString('utf8');
  const manifest = xmlParser.parse(manifestXml);

  // Determine SCORM version
  let version = '1.2'; // default
  const schemaVersion = manifest?.manifest?.metadata?.schemaversion ||
    manifest?.manifest?.metadata?.['lom:lom']?.['lom:general']?.['lom:description']?.['lom:string'] || '';

  if (String(schemaVersion).includes('2004') || String(schemaVersion).includes('1.3')) {
    version = '2004';
  }

  // Get title from organization
  const orgs = manifest?.manifest?.organizations;
  const defaultOrg = orgs?.organization;
  const orgArray = Array.isArray(defaultOrg) ? defaultOrg : defaultOrg ? [defaultOrg] : [];
  const title = orgArray[0]?.title || manifest?.manifest?.['@_identifier'] || 'SCORM Module';

  // Find launch file (resource with adlcp:scormtype="sco")
  const resources = manifest?.manifest?.resources?.resource;
  const resourceArray = Array.isArray(resources) ? resources : resources ? [resources] : [];

  let launchFile = null;
  for (const resource of resourceArray) {
    if (resource['@_adlcp:scormtype']?.toLowerCase() === 'sco' ||
        resource['@_adlcp:scormType']?.toLowerCase() === 'sco' ||
        resource['@_type']?.includes('webcontent')) {
      launchFile = resource['@_href'];
      break;
    }
  }

  if (!launchFile && resourceArray.length > 0) {
    launchFile = resourceArray[0]['@_href'];
  }

  if (!launchFile) {
    throw new Error('Invalid SCORM package: no launch file found in manifest');
  }

  // Extract files to uploads/scorm/{moduleId}/
  const extractDir = path.join(uploadDir, 'scorm', moduleId);
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }
  zip.extractAllTo(extractDir, true);

  // Build organization structure (items)
  const items = [];
  const orgItems = orgArray[0]?.item;
  const itemArray = Array.isArray(orgItems) ? orgItems : orgItems ? [orgItems] : [];
  for (const item of itemArray) {
    items.push({
      identifier: item['@_identifier'],
      title: item.title || '',
      resourceId: item['@_identifierref'],
    });
  }

  return {
    title,
    version,
    launchFile,
    organization: items,
    metadata: {
      schema: manifest?.manifest?.metadata?.schema || 'ADL SCORM',
      schemaVersion: String(schemaVersion),
      identifier: manifest?.manifest?.['@_identifier'] || '',
    },
  };
}
