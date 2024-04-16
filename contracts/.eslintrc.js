module.exports = {
    env: {
        browser: true,
        es2021: true,
    },
    extends: [
        'airbnb-base',
        'plugin:import/errors',
        'plugin:import/warnings',
        'plugin:import/typescript',
        'plugin:prettier/recommended',
    ],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    plugins: ['@typescript-eslint'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': 'warn',
        'import/prefer-default-export': 'off',
        'import/extensions': [
            'error',
            'ignorePackages',
            {
                js: 'never',
                jsx: 'never',
                ts: 'never',
                tsx: 'never',
            },
        ],
        'import/no-extraneous-dependencies': [
            'error',
            {
                devDependencies: ['**/*.test.ts'],
            },
        ],
        'prettier/prettier': [
            'error',
            {
                tabWidth: 4,
            },
        ],
    },
    overrides: [
        {
            files: ['*.ts'],
            rules: {
                'no-continue': 'off',
                'no-console': 'off',
                'max-classes-per-file': 'off',
                'import/no-extraneous-dependencies': 'off',
            },
        },
        {
            files: ['*.algo.ts'],
            rules: {
                'object-shorthand': 'off',
                'class-methods-use-this': 'off',
                'no-undef': 'off',
                'max-classes-per-file': 'off',
                'no-bitwise': 'off',
                'operator-assignment': 'off',
                'prefer-template': 'off',
                'prefer-destructuring': 'off',
                'no-param-reassign': 'off',
                'no-restricted-syntax': 'off',
                'no-continue': 'off',
                'no-unused-vars': 'off',
                '@typescript-eslint/ban-ts-comment': 'off',
            },
        },
        {
            files: ['*.test.ts'],
            rules: {
                'no-await-in-loop': 'off',
            },
        },
    ],
};
