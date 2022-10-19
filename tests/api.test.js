require('dotenv').config();
const axios = require('axios').default;
const { validTopShotToken } = require('../apiRequests');
const getMyProfileResponse = require('./fixtures/getMyProfileResponse.json');

jest.mock('axios');

describe('#validTopShotToken', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });
  test('returns an object with dapperID and flowId', async () => {
    axios.mockImplementationOnce(() => Promise.resolve({ data: getMyProfileResponse }));

    const response = await validTopShotToken('mytoken');

    expect(axios).toHaveBeenCalled();

    expect(response).toHaveProperty('dapperID');
    expect(response.dapperID).toMatch('auth|123456789');
    expect(response).toHaveProperty('flowAddress');
    expect(response.flowAddress).toMatch('f1000000000000000');
  });
  test('returns false if error', async () => {
    axios.mockImplementationOnce(() => Promise.resolve({ data: { errors: ['errrr'] } }));

    const response = await validTopShotToken('mytoken');

    expect(axios).toHaveBeenCalled();

    expect(response).toBeFalsy();
  });
});
