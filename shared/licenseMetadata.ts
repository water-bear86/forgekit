export interface LicenseAttribute {
  trait_type: string;
  value: string | number;
}

export interface LicenseFile {
  uri: string;
  type: "image/png";
}

export interface LicenseMetadataInput {
  name: string;
  description: string;
  image: string;
  externalUrl: string;
  attributes: LicenseAttribute[];
  properties: Record<string, unknown>;
}

export interface LicenseMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: LicenseAttribute[];
  properties: Record<string, unknown> & {
    category: "image";
    files: LicenseFile[];
  };
}

export function buildLicenseMetadata(input: LicenseMetadataInput): LicenseMetadata {
  return {
    name: input.name,
    description: input.description,
    image: input.image,
    external_url: input.externalUrl,
    attributes: input.attributes,
    properties: {
      ...input.properties,
      category: "image",
      files: [{ uri: input.image, type: "image/png" }],
    },
  };
}
