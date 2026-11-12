import { z } from 'zod';
declare const projectRawSchema: z.ZodObject<{
    output_dir: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
declare const orgRawSchema: z.ZodObject<{
    base_url: z.ZodURL;
    user_email: z.ZodEmail;
    include_subtasks: z.ZodOptional<z.ZodBoolean>;
    confluence_urls: z.ZodOptional<z.ZodArray<z.ZodURL>>;
    video_frames: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        fps: z.ZodOptional<z.ZodNumber>;
        quality: z.ZodOptional<z.ZodNumber>;
        max_frames: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    export: z.ZodOptional<z.ZodObject<{
        fields: z.ZodOptional<z.ZodObject<{
            preset: z.ZodOptional<z.ZodEnum<{
                minimal: "minimal";
                default: "default";
                all: "all";
            }>>;
            include: z.ZodOptional<z.ZodArray<z.ZodString>>;
            exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        custom_fields: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            id: z.ZodString;
            type: z.ZodEnum<{
                number: "number";
                sprint: "sprint";
                scalar: "scalar";
                select: "select";
                user: "user";
                array: "array";
            }>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    projects: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        output_dir: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
declare const configRawSchema: z.ZodObject<{
    orgs: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        base_url: z.ZodURL;
        user_email: z.ZodEmail;
        include_subtasks: z.ZodOptional<z.ZodBoolean>;
        confluence_urls: z.ZodOptional<z.ZodArray<z.ZodURL>>;
        video_frames: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            fps: z.ZodOptional<z.ZodNumber>;
            quality: z.ZodOptional<z.ZodNumber>;
            max_frames: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        export: z.ZodOptional<z.ZodObject<{
            fields: z.ZodOptional<z.ZodObject<{
                preset: z.ZodOptional<z.ZodEnum<{
                    minimal: "minimal";
                    default: "default";
                    all: "all";
                }>>;
                include: z.ZodOptional<z.ZodArray<z.ZodString>>;
                exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strict>>;
            custom_fields: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
                id: z.ZodString;
                type: z.ZodEnum<{
                    number: "number";
                    sprint: "sprint";
                    scalar: "scalar";
                    select: "select";
                    user: "user";
                    array: "array";
                }>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        projects: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            output_dir: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type RawProject = z.infer<typeof projectRawSchema>;
export type RawOrg = z.infer<typeof orgRawSchema>;
export type RawConfig = z.infer<typeof configRawSchema>;
export declare function parseConfig(input: unknown, sourcePath?: string): RawConfig;
export {};
//# sourceMappingURL=configSchema.d.ts.map