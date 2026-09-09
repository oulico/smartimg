# AWS deployment

Deployment is ordered; each step consumes an output from the previous one.

## 1. Create the originals bucket

```bash
aws cloudformation deploy \
  --template-file images-bucket.yaml \
  --stack-name smartimg-images \
  --parameter-overrides \
    BucketName=mycompany-smartimg-images \
    AdminOrigin=https://images-admin.mycompany.com \
  --region ap-northeast-2
```

The bucket is private, versioned, encrypted, blocks all public access, and
allows browser PUT requests only from the admin origin (for presigned
uploads). Set AdminOrigin to wherever the admin UI is served.

## 2. Deploy AWS Dynamic Image Transformation (DIT)

Launch the AWS solution from its official page
(https://aws.amazon.com/solutions/implementations/dynamic-image-transformation-for-amazon-cloudfront/)
and point its SourceBuckets parameter at the bucket created in step 1.
The template creates the CloudFront distribution with an origin access
control (OAC) that is the only thing allowed to read objects.

When deployment finishes, copy the distribution domain
(dxxxxxxxx.cloudfront.net) and set it as VITE_IMAGE_CDN_URL for the web
build.

## 3. Grant the API server access to the bucket

The API server only needs enough S3 access to sign uploads, list keys, and
delete objects. It never reads or writes image bytes:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::mycompany-smartimg-images/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::mycompany-smartimg-images"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:DeleteObject"],
      "Resource": "arn:aws:s3:::mycompany-smartimg-images/*"
    }
  ]
}
```

## 4. Bucket policy for CloudFront

The DIT template normally attaches the OAC bucket policy for you. If you
deployed the distribution separately, follow the "Amazon S3 origin" section
of the DIT implementation guide: allow s3:GetObject for the CloudFront
service principal, conditioned on the distribution ARN.

## 5. Caching notes

Uploads set Cache-Control: public, max-age=31536000, immutable (the API
signs this header into every PUT). Keys are UUID-prefixed and never
overwritten, so both CloudFront and browsers can cache originals and
transforms forever. Replacing an image means uploading a new key and
pointing at the new URL.
