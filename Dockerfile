# Use AWS Lambda Node.js 18 base image
FROM public.ecr.aws/lambda/nodejs:18

# Install system dependencies: Python, pip, git, and build tools
RUN yum install -y python3 python3-pip git gcc python3-devel && yum clean all

# Install Semgrep
RUN pip3 install --no-cache-dir semgrep

# Set working directory
WORKDIR /var/task

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy app code
COPY . .

# Lambda handler
CMD [ "lambda.handler" ]
